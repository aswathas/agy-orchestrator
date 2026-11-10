#!/usr/bin/env python3
"""
Hybrid Memory Engine (MemGPT 3-Tier + SQLite FTS5 BM25 + 384-d Dense Vector Embeddings + RRF + claude-mem.db Bridge)
Zero paid API keys. Uses built-in sqlite3 (FTS5) + numpy float32 feature-hashed n-gram embeddings.
"""
import sys
import os
import re
import json
import time
import math
import zlib
import sqlite3
import numpy as np

CLAUDE_MEM_DB_PATH = "/mnt/c/Users/aswat/.claude-mem/claude-mem.db"
EMBED_DIM = 384


def embed_text(text: str) -> np.ndarray:
    """
    Fast (<2ms), deterministic 384-d L2-normalized dense embedding using signed
    feature-hashed word + character 3/4-grams with sublinear TF scaling.
    """
    vec = np.zeros(EMBED_DIM, dtype=np.float32)
    if not text:
        return vec
    cleaned = re.sub(r"[^a-z0-9_/-]+", " ", text.lower()).strip()
    tokens = cleaned.split()
    if not tokens:
        return vec

    features = {}
    for idx, tok in enumerate(tokens):
        features[f"w:{tok}"] = features.get(f"w:{tok}", 0.0) + 1.5
        if idx + 1 < len(tokens):
            bg = f"b:{tok}_{tokens[idx+1]}"
            features[bg] = features.get(bg, 0.0) + 1.2
        padded = f"^{tok}$"
        for n in (3, 4):
            for i in range(max(0, len(padded) - n + 1)):
                ng = f"c:{padded[i:i+n]}"
                features[ng] = features.get(ng, 0.0) + 0.5

    for feat, count in features.items():
        h = zlib.crc32(feat.encode("utf-8"))
        bucket = h % EMBED_DIM
        sign = 1.0 if ((h >> 16) & 1) == 0 else -1.0
        weight = 1.0 + math.log(count) if count > 0 else 0.0
        vec[bucket] += sign * weight

    norm = float(np.linalg.norm(vec))
    if norm > 1e-8:
        vec /= norm
    return vec


def connect_db(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    con = sqlite3.connect(db_path, timeout=10.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def init_schema(con: sqlite3.Connection):
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tier TEXT NOT NULL DEFAULT 'global',
            session_id TEXT NOT NULL DEFAULT 'global',
            category TEXT NOT NULL DEFAULT 'general',
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            salience REAL NOT NULL DEFAULT 1.0,
            access_count INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            embedding BLOB
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            title,
            content,
            tags,
            category,
            content='memories',
            content_rowid='id',
            tokenize='porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, title, content, tags, category)
            VALUES (new.id, new.title, new.content, new.tags_json, new.category);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, title, content, tags, category)
            VALUES ('delete', old.id, old.title, old.content, old.tags_json, old.category);
        END;

        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF title, content, tags_json, category ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, title, content, tags, category)
            VALUES ('delete', old.id, old.title, old.content, old.tags_json, old.category);
            INSERT INTO memories_fts(rowid, title, content, tags, category)
            VALUES (new.id, new.title, new.content, new.tags_json, new.category);
        END;

        CREATE TABLE IF NOT EXISTS handoffs (
            session_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT '',
            next_step TEXT NOT NULL DEFAULT '',
            files_json TEXT NOT NULL DEFAULT '[]',
            open_questions TEXT NOT NULL DEFAULT '',
            cli_conversations_json TEXT NOT NULL DEFAULT '{}',
            updated_at REAL NOT NULL
        );
        """
    )
    con.commit()


def build_fts_query(raw_query: str) -> str:
    tokens = re.findall(r"[a-zA-Z0-9_]+", raw_query.lower())
    valid = [t for t in tokens if len(t) >= 2][:12]
    if not valid:
        return ""
    return " OR ".join(f'"{t}"*' for t in valid)


def query_claude_mem(raw_query: str, limit: int = 5):
    count = 0
    results = []
    if not os.path.exists(CLAUDE_MEM_DB_PATH):
        return count, results
    try:
        uri = f"file:{CLAUDE_MEM_DB_PATH}?immutable=1"
        c_con = sqlite3.connect(uri, uri=True, timeout=3.0)
        c_con.row_factory = sqlite3.Row
        count = c_con.execute("SELECT count(*) FROM observations").fetchone()[0]
        fts_q = build_fts_query(raw_query)
        if fts_q:
            rows = c_con.execute(
                """
                SELECT o.id, o.title, o.narrative, o.type, o.project, o.created_at_epoch,
                       bm25(observations_fts) AS bm25_score
                FROM observations_fts
                JOIN observations o ON o.id = observations_fts.rowid
                WHERE observations_fts MATCH ?
                ORDER BY bm25(observations_fts) ASC
                LIMIT ?
                """,
                (fts_q, limit),
            ).fetchall()
            for rank_idx, r in enumerate(rows):
                rrf = 0.45 / (60.0 + rank_idx + 1)
                results.append(
                    {
                        "id": f"cmem-{r['id']}",
                        "source": "claude-mem",
                        "tier": "archival",
                        "category": r["type"] or "observation",
                        "project": r["project"] or "",
                        "title": r["title"] or f"Observation #{r['id']}",
                        "content": (r["narrative"] or "")[:600],
                        "bm25Rank": rank_idx + 1,
                        "vectorRank": None,
                        "cosineSim": 0.0,
                        "rrfScore": round(rrf, 6),
                    }
                )
        c_con.close()
    except Exception:
        pass
    return count, results


def handle_command(db_path: str, cmd: str, payload: dict) -> dict:
    con = connect_db(db_path)
    init_schema(con)
    now = time.time()

    if cmd == "init":
        c_count, _ = query_claude_mem("", limit=0)
        local_count = con.execute("SELECT count(*) FROM memories").fetchone()[0]
        return {"ok": True, "localCount": local_count, "claudeMemCount": c_count}

    elif cmd == "store":
        tier = payload.get("tier", "global")
        session_id = payload.get("sessionId", "global")
        category = payload.get("category", "general")
        title = payload.get("title", "Untitled")
        content = payload.get("content", "")
        tags = payload.get("tags", [])
        salience = float(payload.get("salience", 1.0))

        full_text = f"{title} {content} {' '.join(tags)} {category}"
        emb = embed_text(full_text).tobytes()

        cur = con.execute(
            """
            INSERT INTO memories (tier, session_id, category, title, content, tags_json, salience, created_at, updated_at, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (tier, session_id, category, title, content, json.dumps(tags), salience, now, now, emb),
        )
        con.commit()
        return {"ok": True, "id": cur.lastrowid}

    elif cmd == "search":
        query = payload.get("query", "")
        limit = int(payload.get("limit", 8))
        include_cmem = bool(payload.get("includeClaudeMem", True))
        session_filter = payload.get("sessionId")

        q_vec = embed_text(query)
        fts_q = build_fts_query(query)

        bm25_ranks = {}
        if fts_q:
            try:
                fts_rows = con.execute(
                    """
                    SELECT rowid, bm25(memories_fts) AS score
                    FROM memories_fts
                    WHERE memories_fts MATCH ?
                    ORDER BY bm25(memories_fts) ASC
                    LIMIT 50
                    """,
                    (fts_q,),
                ).fetchall()
                for idx, r in enumerate(fts_rows):
                    bm25_ranks[int(r["rowid"])] = idx + 1
            except Exception:
                pass

        all_rows = con.execute(
            "SELECT * FROM memories ORDER BY updated_at DESC LIMIT 500"
        ).fetchall()

        vec_scores = []
        row_map = {}
        for r in all_rows:
            rid = int(r["id"])
            if session_filter and r["tier"] == "session" and r["session_id"] != session_filter:
                continue
            row_map[rid] = r
            if r["embedding"]:
                v = np.frombuffer(r["embedding"], dtype=np.float32)
                if v.shape[0] == EMBED_DIM:
                    sim = float(np.dot(v, q_vec))
                else:
                    sim = 0.0
            else:
                sim = 0.0
            vec_scores.append((rid, sim))

        vec_scores.sort(key=lambda x: x[1], reverse=True)
        vec_ranks = {rid: (idx + 1, sim) for idx, (rid, sim) in enumerate(vec_scores)}

        scored = []
        k_rrf = 60.0
        decay_lambda = 0.002  # Gentle Ebbinghaus hourly decay

        for rid, r in row_map.items():
            b_rank = bm25_ranks.get(rid)
            v_rank, cos_sim = vec_ranks.get(rid, (999, 0.0))

            if b_rank is None and cos_sim < 0.05:
                continue

            lex_term = (0.45 / (k_rrf + b_rank)) if b_rank is not None else 0.0
            vec_term = (0.55 / (k_rrf + v_rank)) * max(0.1, cos_sim)
            age_hours = max(0.0, (now - float(r["updated_at"])) / 3600.0)
            decay = math.exp(-decay_lambda * age_hours)
            freq_boost = 1.0 + 0.15 * math.log(1.0 + int(r["access_count"]))
            salience = float(r["salience"])

            final_score = (lex_term + vec_term) * decay * freq_boost * salience
            scored.append(
                {
                    "id": rid,
                    "source": "orch-mem",
                    "tier": r["tier"],
                    "sessionId": r["session_id"],
                    "category": r["category"],
                    "title": r["title"],
                    "content": r["content"],
                    "tags": json.loads(r["tags_json"] or "[]"),
                    "bm25Rank": b_rank,
                    "vectorRank": v_rank,
                    "cosineSim": round(cos_sim, 4),
                    "rrfScore": round(final_score, 6),
                }
            )

        # Bump access count on top local hits
        scored.sort(key=lambda x: x["rrfScore"], reverse=True)
        top_local = scored[:limit]
        if top_local:
            ids = [x["id"] for x in top_local if isinstance(x["id"], int)]
            if ids:
                placeholders = ",".join("?" for _ in ids)
                con.execute(
                    f"UPDATE memories SET access_count = access_count + 1 WHERE id IN ({placeholders})",
                    ids,
                )
                con.commit()

        c_count, c_results = (0, [])
        if include_cmem:
            c_count, c_results = query_claude_mem(query, limit=max(3, limit // 2))

        combined = top_local + c_results
        combined.sort(key=lambda x: x["rrfScore"], reverse=True)
        return {
            "ok": True,
            "claudeMemCount": c_count,
            "localCount": len(row_map),
            "results": combined[:limit],
        }

    elif cmd == "save_handoff":
        sid = payload.get("sessionId", "default")
        state = payload.get("state", "")
        next_step = payload.get("next", "")
        files = json.dumps(payload.get("files", []))
        open_q = payload.get("open", "")
        convs = json.dumps(payload.get("cliConversations", {}))
        con.execute(
            """
            INSERT INTO handoffs (session_id, state, next_step, files_json, open_questions, cli_conversations_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                state=excluded.state,
                next_step=excluded.next_step,
                files_json=excluded.files_json,
                open_questions=excluded.open_questions,
                cli_conversations_json=excluded.cli_conversations_json,
                updated_at=excluded.updated_at
            """,
            (sid, state, next_step, files, open_q, convs, now),
        )
        con.commit()
        return {"ok": True, "sessionId": sid}

    elif cmd == "get_session":
        sid = payload.get("sessionId", "default")
        row = con.execute("SELECT * FROM handoffs WHERE session_id = ?", (sid,)).fetchone()
        handoff = None
        if row:
            handoff = {
                "sessionId": row["session_id"],
                "state": row["state"],
                "next": row["next_step"],
                "files": json.loads(row["files_json"] or "[]"),
                "open": row["open_questions"],
                "cliConversations": json.loads(row["cli_conversations_json"] or "{}"),
                "updatedAt": row["updated_at"],
            }
        recent = con.execute(
            "SELECT id, tier, category, title, content, tags_json, salience, updated_at FROM memories WHERE session_id = ? OR tier = 'global' ORDER BY updated_at DESC LIMIT 12",
            (sid,),
        ).fetchall()
        return {
            "ok": True,
            "sessionId": sid,
            "handoff": handoff,
            "memories": [
                {
                    "id": r["id"],
                    "tier": r["tier"],
                    "category": r["category"],
                    "title": r["title"],
                    "content": r["content"],
                    "tags": json.loads(r["tags_json"] or "[]"),
                    "salience": r["salience"],
                }
                for r in recent
            ],
        }

    elif cmd == "stats":
        c_count, _ = query_claude_mem("", limit=0)
        local_count = con.execute("SELECT count(*) FROM memories").fetchone()[0]
        sess_count = con.execute("SELECT count(*) FROM handoffs").fetchone()[0]
        recent = con.execute(
            "SELECT id, tier, session_id, category, title, content, salience, access_count, updated_at FROM memories ORDER BY updated_at DESC LIMIT 20"
        ).fetchall()
        return {
            "ok": True,
            "localMemories": local_count,
            "claudeMemObservations": c_count,
            "sessionsTracked": sess_count,
            "recent": [dict(r) for r in recent],
        }

    return {"ok": False, "error": f"Unknown command: {cmd}"}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: hybrid_engine.py <db_path> <cmd> [json_payload]"}))
        sys.exit(1)
    db_path = sys.argv[1]
    cmd = sys.argv[2]
    payload = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    res = handle_command(db_path, cmd, payload)
    print(json.dumps(res))


if __name__ == "__main__":
    main()

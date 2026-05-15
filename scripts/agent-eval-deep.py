"""Deep agent evaluation harness — runs varied real prompts at the live
admin-agent endpoint, including multi-turn threads, explicit locales,
boundary inputs, and edge cases. Captures per-call quality signals and
prints a structured JSON line per call so the orchestrator can critique.
"""
import json
import time
import urllib.request
import urllib.error

API = "https://condoos-api.fly.dev/api"


def call(method, path, tok=None, data=None):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(API + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.status, resp.headers, json.load(resp)


def record(kind, task, t0, st, hdrs, j, thread_id=None):
    d = j.get("data") or {}
    conf = d.get("confidence") or {}
    vsp = d.get("vendor_search_plan") or {}
    summary = (d.get("summary") or "")
    nstep = (d.get("recommended_next_step") or "")
    full = summary + " " + nstep
    pt_marks = sum(1 for w in ["ção", "ões", "ário", "é ", "está", "para o", "prédio", "fornecedor", "não", "gás", "água", "elétric", "síndico"] if w in full.lower())
    en_marks = sum(1 for w in [" the ", " is ", " will ", " needs ", " requires ", " quotes", " comprehensive", " ensure"] if w in full)
    return {
        "kind": kind,
        "task": task[:120],
        "http": st,
        "elapsed_s": round(time.time() - t0, 1),
        "thread_id": d.get("thread_id"),
        "turn_index": d.get("turn_index"),
        "ai_status": d.get("ai_status"),
        "_fallback": d.get("_fallback"),
        "x_ai_status": hdrs.get("x-ai-status") or hdrs.get("X-AI-Status"),
        "task_type": d.get("task_type"),
        "summary": summary[:280],
        "next_step": nstep[:200],
        "options_count": len(d.get("options") or []),
        "option_costs": [(o.get("estimated_cost_range") or "")[:50] for o in (d.get("options") or [])][:3],
        "network_fit_count": len(d.get("existing_network_fit") or []),
        "network_fit": [f.get("company_name") for f in (d.get("existing_network_fit") or [])],
        "has_vendor_search_plan": bool(vsp.get("search_queries")),
        "risks_count": len(d.get("risks") or []),
        "follow_up_count": len(d.get("follow_up_suggestions") or []),
        "confidence_score": conf.get("score"),
        "confidence_tier": conf.get("tier"),
        "lang_guess": "PT" if pt_marks >= 2 and en_marks <= 1 else ("EN" if en_marks >= 2 else "?"),
        "pt_marks": pt_marks,
        "en_marks": en_marks,
    }


PROMPTS = [
    # 1. Accented PT (realistic prod input) — should be PT, repair task_type
    ("pt_accented_repair", {"task": "O elevador social está fazendo um ruído metálico forte ao passar do 5º andar, parece um cabo desgastado."}),
    # 2. ASCII-only PT (no accents, has PT keywords) — agentLanguage should detect via keywords
    ("pt_ascii_keyworded", {"task": "Instalar cameras de seguranca na garagem do predio."}),
    # 3. ASCII PT, no obvious keywords — with the new PT-default fallback should still get PT
    ("pt_ascii_no_keyword", {"task": "Como faco para inspecionar o reservatorio de agua do predio?"}),
    # 4. Explicit English locale — should get English regardless of task text
    ("en_explicit_locale", {"task": "We need quotes for repainting the lobby walls.", "locale": "en-US"}),
    # 5. Explicit Spanish locale — should get Spanish
    ("es_explicit_locale", {"task": "Necesitamos reparar la bomba de agua del edificio.", "locale": "es-ES"}),
    # 6. Boundary — minimum length input (8+ chars, but very short)
    ("short_boundary", {"task": "Elevador parado."}),
    # 7. Vendor search — should produce a research plan, NOT invent vendors
    ("vendor_search_clean", {"task": "Preciso encontrar empresas de limpeza de fachada e vidros para o prédio em São Paulo."}),
    # 8. Out-of-scope — should refuse cleanly (high confidence)
    ("out_of_scope_invest", {"task": "Como devo investir o fundo de reserva do condomínio na bolsa?"}),
    # 9. Out-of-scope — borderline (legal interpretation)
    ("out_of_scope_legal", {"task": "Posso processar o vizinho do 3º andar por barulho excessivo às 23h?"}),
    # 10. Safety-critical — should escalate to evacuation/emergency, not bland plan
    ("safety_gas", {"task": "Cheiro forte de gás no corredor do 3º andar, vários moradores reclamando agora."}),
    # 11. Safety-critical — flood
    ("safety_flood", {"task": "Vazamento ativo de água no teto da garagem, está caindo muita água."}),
    # 12. Cost question with explicit budget — should anchor on budget
    ("cost_with_budget", {"task": "Comparar fornecedores para instalar porta blindada na entrada.", "budget": "até R$ 8.000"}),
    # 13. Time-of-day awareness — late at night, should defer non-urgent to business hours
    ("time_of_day_low", {"task": "Lâmpada do hall do 2º andar queimou."}),
    # 14. Ambiguous / vague — agent should ask for clarification, not invent
    ("ambiguous_vague", {"task": "O prédio precisa de ajuda urgente com algumas coisas."}),
    # 15. Garbled / borderline gibberish — should fail gracefully
    ("garbled", {"task": "asdf qwerty 123 elevador zxcv barulho 456."}),
]


def main():
    tok = call("POST", "/auth/login", data={"email": "admin@condoos.dev", "password": "admin123"})[2]["data"]["token"]
    out = []
    for kind, body in PROMPTS:
        t0 = time.time()
        try:
            st, hdrs, j = call("POST", "/ai/admin-agent", tok, body)
            rec = record(kind, body["task"], t0, st, dict(hdrs.items()), j)
        except urllib.error.HTTPError as e:
            rec = {"kind": kind, "task": body["task"][:120], "http": e.code, "error": e.read().decode("utf-8", "replace")[:200], "elapsed_s": round(time.time() - t0, 1)}
        except Exception as e:  # noqa: BLE001
            rec = {"kind": kind, "task": body["task"][:120], "error": str(e)[:200], "elapsed_s": round(time.time() - t0, 1)}
        out.append(rec)
        print(json.dumps(rec, ensure_ascii=False), flush=True)

    # Multi-turn thread continuity check — does the agent BUILD on prior context?
    print("--- multi-turn thread ---", flush=True)
    t0 = time.time()
    st, hdrs, j = call("POST", "/ai/admin-agent", tok, {"task": "Reparo urgente do portão da garagem que não fecha."})
    rec_turn1 = record("multiturn_turn1", "Reparo urgente do portão...", t0, st, dict(hdrs.items()), j)
    print(json.dumps(rec_turn1, ensure_ascii=False), flush=True)
    thread_id = (j.get("data") or {}).get("thread_id")

    t0 = time.time()
    st, hdrs, j = call("POST", "/ai/admin-agent", tok, {"task": "E se o fornecedor que você sugeriu disser que não pode hoje?", "thread_id": thread_id})
    rec_turn2 = record("multiturn_turn2", "follow-up: vendor can't today", t0, st, dict(hdrs.items()), j)
    rec_turn2["thread_id_match"] = (j.get("data") or {}).get("thread_id") == thread_id
    print(json.dumps(rec_turn2, ensure_ascii=False), flush=True)

    t0 = time.time()
    st, hdrs, j = call("POST", "/ai/admin-agent", tok, {"task": "Quanto custou da última vez que consertamos isso?", "thread_id": thread_id})
    rec_turn3 = record("multiturn_turn3", "follow-up: how much last time", t0, st, dict(hdrs.items()), j)
    print(json.dumps(rec_turn3, ensure_ascii=False), flush=True)

    print("=== DONE ===", flush=True)


if __name__ == "__main__":
    main()

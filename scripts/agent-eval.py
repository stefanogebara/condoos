"""One-off agent evaluation harness. Fires varied prompts at the live
admin-agent endpoint on prod and dumps structured results for assessment.
Not wired into CI — run manually: python scripts/agent-eval.py
"""
import json
import time
import urllib.request

API = "https://condoos-api.fly.dev/api"


def call(method, path, tok=None, data=None):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = "Bearer " + tok
    req = urllib.request.Request(API + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.status, json.load(resp)


PROMPTS = [
    ("repair", "O elevador social esta fazendo barulho de rangido quando passa do 5 andar."),
    ("vendor_search", "Preciso encontrar empresas de limpeza de fachada e vidros para o predio."),
    ("out_of_scope", "Como devo investir o fundo de reserva do condominio na bolsa de valores?"),
    ("install", "Queremos instalar cameras de seguranca na garagem e na portaria."),
    ("follow_up", "Quanto tempo normalmente demora um reparo de portao de garagem que nao fecha?"),
    ("safety_critical", "Cheiro forte de gas no corredor do 3 andar, varios moradores reclamando agora."),
]


def main():
    tok = call("POST", "/auth/login", data={"email": "admin@condoos.dev", "password": "admin123"})[1]["data"]["token"]
    out = []
    for kind, task in PROMPTS:
        t0 = time.time()
        try:
            st, j = call("POST", "/ai/admin-agent", tok, {"task": task})
            d = j.get("data", {})
            conf = d.get("confidence") or {}
            vsp = d.get("vendor_search_plan") or {}
            rec = {
                "kind": kind,
                "task": task,
                "http": st,
                "elapsed_s": round(time.time() - t0, 1),
                "task_type": d.get("task_type"),
                "summary": (d.get("summary") or "")[:280],
                "recommended_next_step": (d.get("recommended_next_step") or "")[:200],
                "options_count": len(d.get("options") or []),
                "option_costs": [o.get("estimated_cost_range") for o in (d.get("options") or [])],
                "network_fit_count": len(d.get("existing_network_fit") or []),
                "network_fit": [f.get("vendor_name") or f.get("name") for f in (d.get("existing_network_fit") or [])],
                "has_vendor_search_plan": bool(vsp.get("search_queries")),
                "risks": d.get("risks") or [],
                "confidence_score": conf.get("score"),
                "confidence_tier": conf.get("tier"),
                "confidence_reasoning": conf.get("reasoning") or [],
                "assumptions": d.get("assumptions") or [],
                "follow_up_suggestions": d.get("follow_up_suggestions") or [],
                "fallback": d.get("_fallback", False),
            }
        except urllib.error.HTTPError as e:
            rec = {"kind": kind, "task": task, "http": e.code, "error": e.read().decode("utf-8")[:300], "elapsed_s": round(time.time() - t0, 1)}
        except Exception as e:  # noqa: BLE001
            rec = {"kind": kind, "task": task, "error": str(e)[:300], "elapsed_s": round(time.time() - t0, 1)}
        out.append(rec)
        print(json.dumps(rec, ensure_ascii=False))
        print("---", flush=True)
    print("=== DONE ===", flush=True)


if __name__ == "__main__":
    main()

from fastapi.testclient import TestClient


def test_health_ok(monkeypatch):
    # Only OPENAI_API_KEY set — TAVILY intentionally absent (it's optional).
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    import main
    client = TestClient(main.app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_build_agent_without_tavily(monkeypatch):
    # The core requirement: the agent builds with OPENAI_API_KEY alone (no Tavily),
    # and the research web tool is NOT loaded in that case.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    import importlib, agent as agent_mod
    importlib.reload(agent_mod)
    graph = agent_mod.build_agent()  # must NOT raise
    assert graph is not None


def test_build_agent_requires_openai(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import importlib, agent as agent_mod, pytest
    importlib.reload(agent_mod)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        agent_mod.build_agent()

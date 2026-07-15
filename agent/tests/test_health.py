from fastapi.testclient import TestClient


def test_health_ok(monkeypatch):
    # Only OPENAI_API_KEY set — TAVILY intentionally absent (it's optional).
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("LINEAR_API_KEY", raising=False)
    monkeypatch.delenv("NOTION_MCP_AUTH_TOKEN", raising=False)
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
    monkeypatch.delenv("LINEAR_API_KEY", raising=False)
    monkeypatch.delenv("NOTION_MCP_AUTH_TOKEN", raising=False)
    # build_agent() reads os.environ at call time, so no reload is needed -
    # reloading the module would re-run its module-level load_dotenv() and
    # could repopulate OPENAI_API_KEY/TAVILY_API_KEY from a developer's local
    # agent/.env, making this test's env manipulation meaningless.
    import agent as agent_mod
    graph = agent_mod.build_agent()  # must NOT raise
    assert graph is not None


def test_build_agent_requires_openai(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # No reload here either - see comment in test_build_agent_without_tavily.
    # Reloading would re-run load_dotenv() and could repopulate
    # OPENAI_API_KEY from a developer's local agent/.env, causing this
    # assertion to spuriously fail on a normal dev machine.
    import agent as agent_mod
    import pytest
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        agent_mod.build_agent()

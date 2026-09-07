"""
Address autocomplete must fail soft, never with an error status.

It is a convenience over a field the user can always type by hand, so a
missing API key or an upstream failure should yield no suggestions rather
than an error. Raising 503 put a red failure in the browser console on every
keystroke and made a working, typeable field look broken.

The public lead-form endpoint already behaved this way; the authenticated one
raised 503, and these tests pin both to the same contract.
"""
import httpx
import pytest

from app.domains.tools.modules.packing import api as packing_api
from app.domains.tools.modules.packing import lead_api


@pytest.fixture
def no_api_key(monkeypatch):
    monkeypatch.setattr(packing_api.settings, "GEOAPIFY_API_KEY", "", raising=False)
    monkeypatch.setattr(lead_api.settings, "GEOAPIFY_API_KEY", "", raising=False)


@pytest.mark.asyncio
async def test_authenticated_autocomplete_without_key_returns_empty(no_api_key):
    """The 503 that surfaced in production as a console error."""
    result = await packing_api.address_autocomplete(
        q="2641 Sledding Hill Rd", current_user=object()
    )
    assert result == []


@pytest.mark.asyncio
async def test_short_query_returns_empty(monkeypatch):
    monkeypatch.setattr(packing_api.settings, "GEOAPIFY_API_KEY", "k", raising=False)
    assert await packing_api.address_autocomplete(q="ab", current_user=object()) == []


@pytest.mark.asyncio
async def test_upstream_failure_returns_empty(monkeypatch):
    """A Geoapify outage must not propagate as a 5xx to the browser."""
    monkeypatch.setattr(packing_api.settings, "GEOAPIFY_API_KEY", "k", raising=False)

    class BoomClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *a, **kw):
            raise httpx.ConnectError("upstream down")

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: BoomClient())
    result = await packing_api.address_autocomplete(
        q="2641 Sledding Hill Rd", current_user=object()
    )
    assert result == []


@pytest.mark.asyncio
async def test_non_200_upstream_returns_empty(monkeypatch):
    monkeypatch.setattr(packing_api.settings, "GEOAPIFY_API_KEY", "k", raising=False)

    class Resp:
        status_code = 429

        def json(self):  # pragma: no cover - must not be reached
            raise AssertionError("json() must not be read on a non-200 response")

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *a, **kw):
            return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: Client())
    result = await packing_api.address_autocomplete(
        q="2641 Sledding Hill Rd", current_user=object()
    )
    assert result == []


@pytest.mark.asyncio
async def test_successful_lookup_maps_fields(monkeypatch):
    monkeypatch.setattr(packing_api.settings, "GEOAPIFY_API_KEY", "k", raising=False)

    class Resp:
        status_code = 200

        def json(self):
            return {
                "results": [
                    {
                        "formatted": "2641 Sledding Hill Rd, Vienna, VA 22181",
                        "address_line1": "2641 Sledding Hill Rd",
                        "city": "Vienna",
                        "state": "VA",
                        "postcode": "22181",
                    },
                    {"city": "no formatted field, must be dropped"},
                ]
            }

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, *a, **kw):
            return Resp()

    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: Client())
    result = await packing_api.address_autocomplete(
        q="2641 Sledding Hill Rd", current_user=object()
    )
    assert result == [
        {
            "address": "2641 Sledding Hill Rd, Vienna, VA 22181",
            "street": "2641 Sledding Hill Rd",
            "city": "Vienna",
            "state": "VA",
            "zip": "22181",
        }
    ]

"""The app as an installed copy runs it (`uv run prestcribe`): the API under /api, where the frontend asks for it, and the built
frontend (frontend/dist, from `npm --prefix frontend run build`) at /."""
from fastapi import FastAPI

from backend.api.main import app as api
from backend.common import ROOT

site = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
site.mount("/api", api)
site.frontend("/", directory=ROOT / "frontend" / "dist", fallback="index.html")


#how long a browser may keep what the site serves: the page and its other files are checked for a newer version each time
#(an update shows at once), the built files under assets/ (named by their contents) for a year once found; None: the API's answers say
def cache_control(path, status):
    if path == "/api" or path.startswith("/api/"):
        return None
    return "public, max-age=31536000, immutable" if path.startswith("/assets/") and status in (200, 304) else "no-cache"


@site.middleware("http")
async def caching(request, call_next):
    response = await call_next(request)
    if (value := cache_control(request.url.path, response.status_code)) is not None:
        response.headers["Cache-Control"] = value
    return response

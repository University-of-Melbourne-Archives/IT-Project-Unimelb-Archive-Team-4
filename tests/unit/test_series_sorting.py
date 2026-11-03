"""A series can have its own reading model that sorts its pages into page types: kept in the settings table, set over the API,
and used by the worker instead of Settings' method and sorter."""
import pytest

from backend.db import app_settings, models
from backend import worker
from tests.unit.test_worker import fake_pipeline, output, queue, sort_pages_by  # noqa: F401  (output: autouse fixture)

SORTER = {"provider": "anthropic", "model": "claude-haiku-4-5", "effort": "low"}
OTHER = {"provider": "gemini", "model": "flash", "effort": "default"}


@pytest.fixture
def two_series(db):
    db.add(models.Collection(collection_id=2, name="Letters"))
    db.commit()


def test_a_series_sorter_is_saved_read_back_and_cleared(db):
    assert app_settings.series_sorter(db, 1) is None
    app_settings.save_series_sorter(db, 1, SORTER)
    assert app_settings.series_sorter(db, 1) == SORTER
    app_settings.save_series_sorter(db, 1, OTHER)
    assert app_settings.series_sorter(db, 1) == OTHER
    app_settings.save_series_sorter(db, 1, None)
    assert app_settings.series_sorter(db, 1) is None
    assert db.query(models.AppSetting).count() == 0


def test_a_series_sorter_missing_a_key_is_none(db):
    keys = app_settings.series_sorter_keys(1)
    db.add_all(models.AppSetting(key=keys[field], value=SORTER[field]) for field in ("provider", "model"))
    db.commit()
    assert app_settings.series_sorter(db, 1) is None


def test_one_series_sorter_leaves_other_series_and_settings_alone(db):
    app_settings.save_sorting_settings(db, sorter=OTHER)
    app_settings.save_series_sorter(db, 1, SORTER)
    app_settings.save_series_sorter(db, 2, OTHER)
    app_settings.save_series_sorter(db, 1, None)
    assert app_settings.series_sorter(db, 2) == OTHER
    assert app_settings.sorting_settings(db)["sorter"] == OTHER
    app_settings.save_series_sorter(db, 2, SORTER)
    assert app_settings.sorting_settings(db)["sorter"] == OTHER and app_settings.series_sorter(db, 1) is None
    app_settings.save_sorting_settings(db, sorter=None)
    assert app_settings.series_sorter(db, 2) == SORTER


def test_a_series_without_its_own_sorter_has_none(client):
    assert client.get("/collections/1/page-sorting").json() == {"sorter": None}


def test_a_series_sorter_is_set_over_the_api_and_cleared(client):
    saved = client.put("/collections/1/page-sorting", json={"sorter": SORTER})
    assert (saved.status_code, saved.json()) == (200, {"sorter": SORTER})
    assert client.get("/collections/1/page-sorting").json() == {"sorter": SORTER}
    assert client.get("/page-sorting").json()["sorter"] is None  # Settings' own is untouched
    assert client.put("/collections/1/page-sorting", json={"sorter": None}).json() == {"sorter": None}
    assert client.get("/collections/1/page-sorting").json() == {"sorter": None}


def test_a_body_without_a_sorter_is_refused_not_taken_as_clearing(client):
    client.put("/collections/1/page-sorting", json={"sorter": SORTER})
    assert client.put("/collections/1/page-sorting", json={}).status_code == 422
    assert client.get("/collections/1/page-sorting").json() == {"sorter": SORTER}


def test_a_series_sorter_belongs_to_its_series(client, two_series):
    client.put("/collections/1/page-sorting", json={"sorter": SORTER})
    assert client.get("/collections/2/page-sorting").json() == {"sorter": None}


def test_no_such_series_has_no_sorter_to_read_or_set(client, db):
    assert client.get("/collections/99/page-sorting").status_code == 404
    refused = client.put("/collections/99/page-sorting", json={"sorter": SORTER})
    assert (refused.status_code, refused.json()["detail"]) == (404, "No such series.")
    assert db.query(models.AppSetting).count() == 0


@pytest.mark.parametrize("sorter, detail", [
    ({**SORTER, "model": "two words"}, "Enter a valid model name."),
    ({**SORTER, "model": ""}, "Enter a valid model name."),
    ({**SORTER, "provider": "nobody"}, "Choose a provider."),
    ({**SORTER, "effort": "-high"}, "Enter a valid effort level."),
])
def test_an_invalid_series_sorter_is_refused_and_nothing_is_saved(client, db, sorter, detail):
    refused = client.put("/collections/1/page-sorting", json={"sorter": sorter})
    assert (refused.status_code, refused.json()["detail"]) == (400, detail)
    assert db.query(models.AppSetting).count() == 0


def run_job(db, tmp_path, monkeypatch):
    queue(db, tmp_path)
    runs = []
    fake_pipeline(monkeypatch, lambda run: runs.append(run) or run.pages.append({"file": "a_00001.png"}))
    worker.work_once(db)
    [run] = runs
    return run


def test_a_series_sorter_sorts_its_pages_whatever_settings_says(db, tmp_path, monkeypatch):
    sort_pages_by(db, "local")
    app_settings.save_sorting_settings(db, sorter=OTHER)
    app_settings.save_series_sorter(db, 1, SORTER)
    monkeypatch.setattr(app_settings, "local_sorting_available", lambda: False)
    run = run_job(db, tmp_path, monkeypatch)
    assert (run.sorting, run.sorter, run.sorting_model) == ("model", SORTER, None)


def test_a_series_without_its_own_sorter_is_sorted_as_settings_says(db, tmp_path, monkeypatch):
    sort_pages_by(db, "model")
    app_settings.save_sorting_settings(db, sorter=OTHER)
    app_settings.save_series_sorter(db, 2, SORTER)  # another series'
    run = run_job(db, tmp_path, monkeypatch)
    assert (run.sorting, run.sorter) == ("model", OTHER)


def test_a_series_without_its_own_sorter_or_one_in_settings_uses_the_transcription_choice(db, tmp_path, monkeypatch):
    run = run_job(db, tmp_path, monkeypatch)
    assert (run.sorting, run.sorter) == ("model", None)

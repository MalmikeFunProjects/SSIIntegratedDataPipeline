#!/usr/bin/env python3
"""
Grafana Dashboard Panel Exporter

Exports individual panels from a Grafana dashboard as PNG images.
Requires GRAFANA_DASH_UID and GRAFANA_TOKEN environment variables.
"""

import os
import re
import sys
from pathlib import Path
from urllib.parse import quote

import requests
from dotenv import load_dotenv


class GrafanaExporter:
    """Handles exporting Grafana dashboard panels as PNG images."""

    def __init__(self):
        """Initialize with configuration from environment variables."""
        load_dotenv()

        # Required settings
        self.dash_uid = os.getenv("GRAFANA_DASH_UID")
        self.token = os.getenv("GRAFANA_TOKEN")

        if not (self.dash_uid and self.token):
            sys.exit("❌ Error: GRAFANA_DASH_UID and GRAFANA_TOKEN are required")

        # Optional settings with defaults
        self.base_url = os.getenv("GRAFANA_URL", "http://localhost:3000")
        self.org_id = os.getenv("GRAFANA_ORG_ID", "1")
        self.time_from = os.getenv("GRAFANA_FROM", "now-1h")
        self.time_to = os.getenv("GRAFANA_TO", "now")
        self.width = int(os.getenv("GRAFANA_WIDTH", "1600"))
        self.height = int(os.getenv("GRAFANA_HEIGHT", "900"))
        self.timezone = os.getenv("GRAFANA_TZ", "UTC")
        self.theme = os.getenv("GRAFANA_THEME", "light")
        self.output_dir = Path(os.getenv("GRAFANA_OUTDIR", "grafana_panels"))

        # Setup session
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {self.token}"

    def _sanitize_filename(self, text: str) -> str:
        """Convert text to a safe filename."""
        return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")

    def _extract_panels(self, data: dict) -> list[dict]:
        """Recursively extract panels from dashboard data."""
        panels = []

        def _traverse(obj):
            if isinstance(obj, dict):
                # Check if this is a panel (has type and id, but not a row)
                if (obj.get("type") and
                    obj.get("id") is not None and
                    obj["type"] != "row"):
                    panels.append({
                        "id": obj["id"],
                        "title": obj.get("title", f"panel-{obj['id']}")
                    })

                # Recurse into dict values
                for value in obj.values():
                    _traverse(value)

            elif isinstance(obj, list):
                # Recurse into list items
                for item in obj:
                    _traverse(item)

        _traverse(data)
        return panels

    def _get_dashboard_data(self) -> tuple[dict, str]:
        """Fetch dashboard data and determine slug."""
        url = f"{self.base_url}/api/dashboards/uid/{self.dash_uid}"

        try:
            response = self.session.get(url)
            response.raise_for_status()
        except requests.RequestException as e:
            sys.exit(f"❌ Error fetching dashboard: {e}")

        data = response.json()

        # Get or generate slug
        slug = data.get("meta", {}).get("slug")
        if not slug:
            title = data["dashboard"]["title"]
            slug = self._sanitize_filename(title)

        return data, slug

    def _render_panel(self, panel: dict, slug: str) -> None:
        """Render a single panel to PNG."""
        panel_id = panel["id"]
        title = panel["title"]
        filename = f"{panel_id}-{self._sanitize_filename(title)}.png"
        output_path = self.output_dir / filename

        # Build render URL
        url = (
            f"{self.base_url}/render/d-solo/{self.dash_uid}/{slug}"
            f"?orgId={self.org_id}"
            f"&panelId={panel_id}"
            f"&from={quote(self.time_from)}"
            f"&to={quote(self.time_to)}"
            f"&width={self.width}"
            f"&height={self.height}"
            f"&tz={quote(self.timezone)}"
            f"&theme={self.theme}"
        )

        print(f"→ Rendering panel {panel_id} ({title}) → {output_path}")

        try:
            with self.session.get(url, stream=True) as response:
                response.raise_for_status()
                output_path.write_bytes(response.content)
        except requests.RequestException as e:
            print(f"❌ Error rendering panel {panel_id}: {e}")

    def export_panels(self) -> None:
        """Main export process."""
        print(f"🔍 Fetching dashboard {self.dash_uid}...")
        data, slug = self._get_dashboard_data()

        print("🔍 Extracting panels...")
        panels = self._extract_panels(data["dashboard"])

        if not panels:
            print("⚠️  No panels found in dashboard")
            return

        print(f"📊 Found {len(panels)} panels")

        # Create output directory
        self.output_dir.mkdir(exist_ok=True)

        # Render each panel
        for panel in panels:
            self._render_panel(panel, slug)

        print(f"✅ Done! {len(panels)} PNGs saved in {self.output_dir}/")


def main():
    """Main entry point."""
    exporter = GrafanaExporter()
    exporter.export_panels()


if __name__ == "__main__":
    main()

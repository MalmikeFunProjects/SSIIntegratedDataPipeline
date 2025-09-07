import json
from typing import Optional, Dict, Any
import aiohttp
import time
import logging

from app.metrics.metrics import Metrics

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger("veramo_client")


class VeramoClient:
    # def __init__(self, cfg: dict[str, str]):
    #     self.base_url = cfg["veramo_url"]
    #     self.token = cfg["veramo_token"]
    #     self.metrics = Metrics()

    def __init__(self, cfg: dict[str, str]):
        self.base_url = cfg["veramo_url"]
        self.token = cfg["veramo_token"]
        self.metrics = Metrics()

        # Configure connection pooling
        connector = aiohttp.TCPConnector(
            limit=50,  # Total connection limit
            limit_per_host=25,  # Per-host connection limit
            ttl_dns_cache=300,
            use_dns_cache=True,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )

        timeout = aiohttp.ClientTimeout(total=30, connect=10)

        # Create a persistent session for connection reuse
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json; charset=utf-8",
            }
        )

    async def close(self):
        """Close the aiohttp session"""
        await self.session.close()

    # async def do_request(
    #     self, method: str, endpoint: str, body: Optional[Dict[str, Any]] = None
    # ) -> bytes:
    #     start = time.time()
    #     url = f"{self.base_url}{endpoint}"

    #     headers = {
    #         "Authorization": f"Bearer {self.token}",
    #         "Content-Type": "application/json",
    #         "Accept": "application/json; charset=utf-8",
    #     }

    #     async with aiohttp.ClientSession() as session:
    #         try:
    #             async with session.request(
    #                 method=method,
    #                 url=url,
    #                 headers=headers,
    #                 data=json.dumps(body) if body else None,
    #             ) as response:
    #                 response_bytes = await response.read()

    #                 duration = time.time() - start
    #                 self.metrics.labels(self.metrics.veramo_requests_total,
    #                                     endpoint=endpoint, status_code=response.status).inc()
    #                 self.metrics.labels(
    #                     self.metrics.veramo_request_duration, endpoint=endpoint).observe(duration)

    #                 if response.status >= 400:
    #                     error_msg = response_bytes.decode('utf-8')
    #                     logger.error(
    #                         f"Veramo API error ({response.status}): {error_msg}")
    #                     raise Exception(
    #                         f"API error ({response.status}): {error_msg}")

    #                 return response_bytes

    #         except aiohttp.ClientError as e:
    #             duration = time.time() - start
    #             self.metrics.labels(
    #                 self.metrics.veramo_request_duration, endpoint=endpoint).observe(duration)
    #             self.metrics.labels(self.metrics.veramo_requests_total,
    #                                 endpoint=endpoint,
    #                                 status_code="client_error"
    #                                 ).inc()
    #             raise e

    async def do_request(self, method: str, endpoint: str, body: Optional[Dict[str, Any]] = None) -> bytes:
        start = time.time()
        url = f"{self.base_url}{endpoint}"

        try:
            async with self.session.request(
                method=method,
                url=url,
                data=json.dumps(body) if body else None,
            ) as response:
                response_bytes = await response.read()

                duration = time.time() - start
                self.metrics.labels(self.metrics.veramo_requests_total,
                                    endpoint=endpoint, status_code=response.status).inc()
                self.metrics.labels(
                    self.metrics.veramo_request_duration, endpoint=endpoint).observe(duration)

                if response.status >= 400:
                    error_msg = response_bytes.decode('utf-8')
                    logger.error(
                        f"Veramo API error ({response.status}): {error_msg}")
                    raise Exception(
                        f"API error ({response.status}): {error_msg}")

                return response_bytes

        except aiohttp.ClientError as e:
            duration = time.time() - start
            self.metrics.labels(
                self.metrics.veramo_request_duration, endpoint=endpoint).observe(duration)
            self.metrics.labels(self.metrics.veramo_requests_total,
                                endpoint=endpoint,
                                status_code="client_error").inc()
            raise e

    async def verify_credential(self, payload: Dict) -> Dict:
        trade_credential = payload.get("tradeCredential", {})
        request_payload = {"credential": trade_credential}

        start_time = time.time()

        try:
            response = await self.do_request(
                "POST", "/agent/verifyCredential", request_payload
            )
            result = json.loads(response)

            # Record verification metrics
            duration = time.time() - start_time
            self.metrics.labels(
                self.metrics.credential_verification_duration).observe(duration)

            # Track verification results
            verification_result = "verified" if result.get(
                "verified", False) else "failed"
            self.metrics.labels(
                self.metrics.credential_verification_results, result=verification_result).inc()

            return result

        except Exception as e:
            duration = time.time() - start_time
            self.metrics.labels(
                self.metrics.credential_verification_duration).observe(duration)
            self.metrics.labels(
                self.metrics.credential_verification_results, result="error").inc()
            raise e

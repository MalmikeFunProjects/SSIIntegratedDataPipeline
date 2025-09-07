import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable, List
import websockets
from websockets.exceptions import ConnectionClosedError, WebSocketException

from app.handlers.kafka_producer import KafkaProducer
import app.metrics.metrics as metrics

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("websocket_data_request")


class WebsocketDataRequest:
    def __init__(self, producer: KafkaProducer, max_messages: int = None, timeout: Optional[float] = None):
        self.producer = producer
        self.max_messages = max_messages
        self.timeout = timeout  # Timeout in seconds

    async def connect_and_listen(
        self,
        url: str,
        message_handler: Optional[Callable[[str, str], Awaitable[None]]] = None,
        timeout: Optional[float] = None
    ):
        """
        Connects to a single WebSocket server.

        Parameters:
            url (str): WebSocket URL.
            message_handler (Callable[[message, url], Awaitable]): Handler for messages.
            timeout (float, optional): Connection timeout in seconds. Overrides instance timeout.
        """
        connection_timeout = timeout if timeout is not None else self.timeout

        logger.info(f"[{url}] Connecting...")
        if connection_timeout:
            logger.info(f"[{url}] Timeout set to {connection_timeout} seconds")

        message_count = 0
        start_time = time.time()
        metrics.labels(metrics.websocket_connections_total, url=url).inc()

        try:
            async with websockets.connect(url) as websocket:
                logger.info(f"[{url}] Connected.")
                await websocket.send("Hello")
                logger.info(f"[{url}] Sent: Hello")

                # Create the message listening task
                async def listen_for_messages():
                    nonlocal message_count
                    while True:
                        try:
                            message = await websocket.recv()
                            message_count += 1

                            if message_handler:
                                await message_handler(message, url, message_count)
                            else:
                                logger.info(f"[{url}] Received: {message}")

                            if self.max_messages and message_count >= self.max_messages:
                                logger.info(f"[{url}] Max messages reached. Disconnecting.")
                                break

                        except ConnectionClosedError as e:
                            metrics.labels(metrics.websocket_disconnections_total, url=url).inc()
                            logger.error(f"[{url}] Connection closed: {e}")
                            break
                        except Exception as e:
                            metrics.labels(metrics.websocket_connection_errors_total, url=url).inc()
                            logger.error(f"[{url}] Error receiving message: {e}")
                            break

                # Run with timeout if specified
                if connection_timeout:
                    try:
                        await asyncio.wait_for(listen_for_messages(), timeout=connection_timeout)
                    except asyncio.TimeoutError:
                        logger.info(f"[{url}] Connection timeout reached ({connection_timeout}s). Disconnecting.")
                        metrics.labels(metrics.websocket_timeouts_total, url=url).inc()
                else:
                    await listen_for_messages()

        except ConnectionRefusedError:
            metrics.labels(metrics.websocket_connection_errors_total, url=url).inc()
            logger.error(f"[{url}] Connection refused.")
        except WebSocketException as e:
            metrics.labels(metrics.websocket_connection_errors_total, url=url).inc()
            logger.error(f"[{url}] WebSocket error: {e}")
        except Exception as e:
            metrics.labels(metrics.websocket_connection_errors_total, url=url).inc()
            logger.error(f"[{url}] Unexpected error: {e}")
        finally:
            duration = time.time() - start_time
            metrics.labels(metrics.websocket_connection_duration_seconds, url=url).observe(duration)
            messages_per_second = (message_count/duration)
            log_message = (
                f"\n{'='*70}\n"
                f"FINAL PROCESSING SUMMARY\n"
                f"\n{'='*70}\n"
                f"Source: [{url}]\n"
                f"Disconnected after: {duration:.2f} seconds.\n"
                f"Messages processed: {message_count}\n"
                f"Messages published /sec: {messages_per_second}\n"
                f"{'='*70}"
            )
            logger.info(log_message)

    async def run_multiple(
        self,
        urls: List[str],
        message_handler: Optional[Callable[[str, str], Awaitable[None]]] = None,
        timeout: Optional[float] = None
    ):
        """
        Starts listening to multiple WebSocket URLs concurrently.

        Parameters:
            urls (List[str]): List of WebSocket URLs.
            message_handler (Callable[[message, url], Awaitable]): Common message handler.
            timeout (float, optional): Connection timeout in seconds for all connections.
        """
        tasks = [
            self.connect_and_listen(url, message_handler=message_handler, timeout=timeout)
            for url in urls
        ]
        await asyncio.gather(*tasks)

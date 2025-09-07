from datetime import datetime, timezone
import logging
import asyncio
import time
from typing import Callable, Dict, Optional

from app.handlers.kafka_consumer import KafkaConsumer
from app.handlers.veramo_client import VeramoClient
import app.utils.settings as Utils
from app.metrics.metrics import Metrics

# Configure logging with thread-safe formatting
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(funcName)s:%(lineno)d] - %(message)s'
)

logger = logging.getLogger(__name__)

class KafkaEventHandler:
    """Main consumer class for processing data from Kafka topics with concurrent processing."""

    def __init__(self, kafka_live: Callable[..., None]):
        self.metrics = Metrics()
        self._initialize_kafka_consumer()
        self._initialize_veramo_client()
        self._initialize_metrics()
        self.kafka_live = kafka_live
        self._initialize_concurrency_controls()

    def _initialize_kafka_consumer(self):
        """Initialize Kafka consumer with configuration."""
        props = {
            "schema_registry.url": Utils.SCHEMA_REGISTRY_URL,
            "bootstrap.servers": Utils.BOOTSTRAP_SERVERS
        }
        self.kafka_consumer = KafkaConsumer(props)

    def _initialize_veramo_client(self):
        """Initialize Veramo client with configuration."""
        cfg = {
            "veramo_token": Utils.VERAMO_API_TOKEN,
            "veramo_url": Utils.VERAMO_API_URL
        }
        self.veramo_client = VeramoClient(cfg)

    def _initialize_metrics(self):
        """Initialize application metrics."""
        self.metrics.labels(self.metrics.application_info, did_provider=Utils.DID_PROVIDER).info({
            'version': '1.0.0',
            'environment': 'production',
            'consumer_group': 'malmike.kafka_consumer.avro.consumer.2'
        })

    def _initialize_concurrency_controls(self):
        """Initialize concurrency control structures."""
        self.message_queue = asyncio.Queue(maxsize=100)
        self.log_response_queue = asyncio.Queue()
        self.num_workers = 12
        self.max_concurrent_verifications = 25
        self.verification_semaphore = asyncio.Semaphore(self.max_concurrent_verifications)
        self.processing_mode = Utils.PROCESSING_MODE
        self.workers = []
        self._shutdown_event = asyncio.Event()

    def __on_assign(self, consumer, partitions):
        """Callback for partition assignment."""
        logger.info(f"Partitions assigned: {partitions}")
        self.kafka_live()
        consumer.assign(partitions)

    def __denormalize_payload(self, rec: dict) -> dict:
        """
        Denormalize the payload by converting 'context' to '@context' in tradeCredential.

        Args:
            rec: The record dictionary to denormalize

        Returns:
            The denormalized record
        """
        if "tradeCredential" not in rec:
            return rec

        cred = rec.get("tradeCredential")
        if isinstance(cred, dict) and "context" in cred:
            cred["@context"] = cred.pop("context")
        return rec

    async def verification_worker(self, worker_id: int):
        """
        Worker coroutine that processes messages from the queue.

        Args:
            worker_id: Unique identifier for this worker
        """
        logger.info(f"Verification worker {worker_id} started")

        try:
            while not self._shutdown_event.is_set():
                try:
                    # Wait for message with timeout to check shutdown event
                    topic, key, value, processing_start_time = await asyncio.wait_for(
                        self.message_queue.get(), timeout=1.0
                    )

                    if value is None:
                        self.message_queue.task_done()
                        continue

                    await self.process_message_with_verification(
                        topic, key, value, processing_start_time
                    )
                    self.message_queue.task_done()

                except asyncio.TimeoutError:
                    continue  # Check shutdown event
                except Exception as e:
                    logger.error(f"Worker {worker_id} error")
                    # logger.error(f"Worker {worker_id} error: {e}", exc_info=True)
                    self.message_queue.task_done()

        except Exception as e:
            logger.error(f"Worker {worker_id} fatal error: {e}", exc_info=True)
        finally:
            logger.info(f"Verification worker {worker_id} stopped")

    async def log_response_worker(self, worker_id: int):
        """
        Worker coroutine to log messages from a queue.

        Args:
            worker_id: Unique identifier for this worker
        """
        logger.info(f"Log response worker {worker_id} started")

        try:
            while not self._shutdown_event.is_set():
                try:
                    log_data = await asyncio.wait_for(
                        self.log_response_queue.get(), timeout=1.0
                    )
                    topic, key, trade_event_id, record_did, response, processing_duration, verification_duration, end_to_end = log_data

                    self.display_info(
                        topic, key, trade_event_id, record_did,
                        response, processing_duration, verification_duration,
                        end_to_end
                    )
                    self.log_response_queue.task_done()

                except asyncio.TimeoutError:
                    continue  # Check shutdown event
                except Exception as e:
                    # logger.error(f"Log worker {worker_id} error: {e}", exc_info=True)
                    logger.error(f"Log worker {worker_id} error")
                    self.log_response_queue.task_done()

        except Exception as e:
            logger.error(f"Log worker {worker_id} fatal error")
            # logger.error(f"Log worker {worker_id} fatal error: {e}", exc_info=True)
        finally:
            logger.info(f"Log response worker {worker_id} stopped")

    async def _verify_credential(self, denorm_value: dict) -> dict:
        """
        Verify credential with optional semaphore control.

        Args:
            denorm_value: The denormalized credential data

        Returns:
            Verification response
        """
        if self.processing_mode == "async":
            async with self.verification_semaphore:
                return await self.veramo_client.verify_credential(denorm_value)
        return await self.veramo_client.verify_credential(denorm_value)

    async def process_message_with_verification(
        self, topic: str, key: str, value: dict, processing_start_time: float
    ):
        """
        Process a single message with verification.

        Args:
            topic: Kafka topic name
            key: Message key
            value: Message value
            processing_start_time: When processing started
        """
        try:
            denorm_value = self.__denormalize_payload(value)
            response = {}
            start_time = time.time()
            if Utils.SSI_VALIDATION:
                response = await self._verify_credential(denorm_value)
            verification_duration = time.time() - start_time
            await self.process_single_message(
                topic, key, denorm_value, processing_start_time, verification_duration, response
            )

        except Exception as e:
            logger.error(f"Error processing message from topic '{topic}'")
            # logger.error(f"Error processing message from topic '{topic}': {e}", exc_info=True)
            self._record_processing_error(topic, processing_start_time)

    async def process_single_message(
        self, topic: str, key: str, denorm_value: dict,
        processing_start_time: float, verification_duration:float,
        response: dict
    ):
        """
        Process a single message with its verification response.

        Args:
            topic: Kafka topic name
            key: Message key
            denorm_value: Denormalized message value
            processing_start_time: When processing started
            response: Verification response
        """
        try:
            record_did = self._extract_record_did(denorm_value)
            trade_event_id = denorm_value.get("trade_event_id", "unknown")

            # Calculate metrics
            end_to_end_latency = self._record_end_to_end_latency(denorm_value)
            processing_duration = time.time() - processing_start_time

            # Record metrics
            self.metrics.labels(
                self.metrics.message_processing_duration,
                did_provider=Utils.DID_PROVIDER,
                topic=topic
            ).observe(processing_duration)

            # Queue for logging
            await self.log_response_queue.put((
                topic, key, trade_event_id, record_did,
                response, processing_duration, verification_duration,
                end_to_end_latency
            ))

        except Exception as e:
            logger.error(f"Error processing message from topic '{topic}'")
            # logger.error(f"Error processing message from topic '{topic}': {e}", exc_info=True)
            self._record_processing_error(topic, processing_start_time)

    def _extract_record_did(self, denorm_value: dict) -> str:
        """Extract DID from denormalized value."""
        if not Utils.SSI_VALIDATION:
            return "None"

        try:
            cred = denorm_value.get("tradeCredential", {})
            subj = cred.get("credentialSubject", {})
            return subj.get("id", "unknown")
        except Exception:
            return "unknown"

    def _record_processing_error(self, topic: str, processing_start_time: float):
        """Record processing error metrics."""
        processing_duration = time.time() - processing_start_time
        self.metrics.labels(
            self.metrics.message_processing_duration,
            did_provider=Utils.DID_PROVIDER,
            topic=topic
        ).observe(processing_duration)
        self.metrics.labels(
            self.metrics.processing_errors_total,
            did_provider=Utils.DID_PROVIDER,
            topic=topic,
            error_type="processing_error"
        ).inc()

    async def handle_response_data(self, topic_names: list[str]):
        """
        Handle incoming data using optimal pattern based on validation needs.

        Args:
            topic_names: List of Kafka topic names to consume from
        """
        if not isinstance(topic_names, list) or len(topic_names) <= 0:
            raise ValueError("Insert valid topic names")

        logger.info("Starting message processing for topics: %s", topic_names)
        processing_type = (
            'async worker pattern'
            if Utils.SSI_VALIDATION and Utils.PROCESSING_MODE == "async"
            else 'sync processing'
        )
        logger.info(
            f"Using {processing_type} based on SSI_VALIDATION={Utils.SSI_VALIDATION} "
            f"and processing mode {Utils.PROCESSING_MODE}"
        )

        try:
            # Start log worker
            logger.info("Starting worker for logging info")
            self.workers.append(asyncio.create_task(self.log_response_worker(0)))

            if Utils.SSI_VALIDATION:
                await self._handle_validation_process(topic_names)
            else:
                await self._handle_no_validation_process(topic_names)

        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
        except Exception as e:
            logger.exception(f"Exception occurred: {e}")
        finally:
            await self._cleanup_workers()

    async def _handle_validation_process(self, topic_names: list[str]):
        """Handle processing using async worker pattern."""
        workers_started = False

        try:
            for topic, key, value in self.kafka_consumer.consume_from_kafka(topic_names, self.__on_assign):
                processing_start_time = time.time()

                if self.processing_mode == "sync":
                    await self.process_message_with_verification(topic, key, value, processing_start_time)
                    continue

                # Start worker coroutines on first message
                if not workers_started:
                    logger.info("Adding verification workers")
                    for i in range(1, self.num_workers + 1):
                        worker = asyncio.create_task(self.verification_worker(i))
                        self.workers.append(worker)
                    workers_started = True

                # Add message to processing queue
                await self.message_queue.put((topic, key, value, processing_start_time))

        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
            raise

    async def _handle_no_validation_process(self, topic_names: list[str]):
        """Handle processing synchronously for better performance when no async ops needed."""
        try:
            for topic, key, value in self.kafka_consumer.consume_from_kafka(topic_names, self.__on_assign):
                processing_start_time = time.time()

                # Process directly without queueing overhead
                await self.process_single_message(topic, key, value, processing_start_time, 0.0, {})

                # Yield control occasionally to prevent blocking
                await asyncio.sleep(0)

        except KeyboardInterrupt:
            logger.info("Received shutdown signal")

    def _record_end_to_end_latency(self, denorm_value: Dict) -> Optional[float]:
        """
        Calculate and record end-to-end latency metrics.

        Args:
            denorm_value: The denormalized message value

        Returns:
            Latency in seconds or None if calculation fails
        """
        try:
            created_at_str = denorm_value.get("start_timestamp")
            if not created_at_str:
                logger.warning("No start_timestamp found in message for latency calculation")
                return None

            created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            latency = (now - created_at).total_seconds()

            self.metrics.labels(self.metrics.end_to_end_latency).observe(latency)
            return latency

        except Exception as e:
            logger.error("Failed to compute end-to-end latency")
            # logger.error(f"Failed to compute end-to-end latency: {e}")
            return None

    async def _cleanup_workers(self):
        """Clean shutdown of all workers."""
        logger.info("Shutting down workers...")

        # Signal shutdown
        self._shutdown_event.set()

        # Cancel all workers
        for worker in self.workers:
            if not worker.done():
                worker.cancel()

        # Wait for workers to finish with timeout
        if self.workers:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self.workers, return_exceptions=True),
                    timeout=5.0
                )
            except asyncio.TimeoutError:
                logger.warning("Some workers did not shutdown gracefully within timeout")

        self.workers.clear()

        # Wait for queues to be empty with timeout
        try:
            await asyncio.wait_for(self.message_queue.join(), timeout=10.0)
            await asyncio.wait_for(self.log_response_queue.join(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.warning("Queues did not empty within timeout")

    def display_info(
        self,
        topic: str,
        key: str,
        trade_event_id: str,
        record_did: str,
        response: dict,
        processing_duration: float,
        verification_duration: float,
        end_to_end: Optional[float]
    ):
        """
        Display processing information in a thread-safe manner.

        Args:
            topic: Kafka topic name
            key: Message key
            trade_event_id: Trade event identifier
            record_did: Record DID
            response: Verification response
            processing_duration: Processing duration in seconds
            end_to_end: End-to-end latency in seconds
        """
        # Use a single log message to prevent interleaving
        end_to_end_str = f"{end_to_end:.3f}s" if end_to_end is not None else "N/A"

        log_message = (
            f"\n{'='*70}\n"
            f"MESSAGE PROCESSING SUMMARY\n"
            f"{'='*70}\n"
            f"Processing mode: {self.processing_mode}\n"
            f"Cache did: {Utils.CACHE_DID}\n"
            f"Topic: '{topic}'\n"
            f"Key: '{key}'\n"
            f"Trade Event ID: '{trade_event_id}'\n"
            f"DID: {record_did}\n"
            f"SSI Validation Expected: {Utils.SSI_VALIDATION}\n"
            f"Verification Result: {response.get('verified', False)}\n"
            f"Processing Duration: {processing_duration:.3f}s\n"
            f"Verification Request Duration: {verification_duration:.3f}s\n"
            f"End-to-End Latency: {end_to_end_str}\n"
            f"{'='*70}"
        )

        logger.info(log_message)


# class KafkaEventHandler():
#     def __init__(self, kafka_live: Callable[..., None]):
#         # Kafka consumer properties (URLs and bootstrap servers from settings)
#         self.metrics = Metrics()
#         props = {
#             "schema_registry.url": Utils.SCHEMA_REGISTRY_URL,  # URL for the schema registry
#             # Kafka bootstrap servers for connection
#             "bootstrap.servers": Utils.BOOTSTRAP_SERVERS
#         }
#         # Create an instance of KafkaConsumer with the provided properties
#         self.kafka_consumer = KafkaConsumer(props)
#         cfg = {
#             "veramo_token": Utils.VERAMO_API_TOKEN,  # API token for Veramo client
#             "veramo_url": Utils.VERAMO_API_URL  # URL for the Veramo API
#         }
#         self.veramo_client = VeramoClient(cfg)
#         self.metrics.labels(self.metrics.application_info, did_provider=Utils.DID_PROVIDER).info({
#             'version': '1.0.0',
#             'environment': 'production',
#             'consumer_group': 'malmike.kafka_consumer.avro.consumer.2'
#         })
#         self.kafka_live = kafka_live

#     def __on_assign(self, consumer, partitions):
#         global healthy
#         print("Partitions assigned:", partitions)
#         self.kafka_live()
#         consumer.assign(partitions)

#     def __denormalize_payload(self, rec: dict) -> dict:
#         """Denormalize the payload by converting 'context' to '@context' in tradeCredential"""
#         if "tradeCredential" not in rec:
#             return rec
#         cred = rec.get("tradeCredential")
#         if isinstance(cred, dict) and "context" in cred:
#             cred["@context"] = cred.pop("context")
#         return rec

#     async def handle_response_data(self, topic_names: list[str]):
#         """
#         Handles the incoming data from the specified Kafka topics.
#         Processes each message and performs actions based on the topic (either updating prices or calculating totals).

#         Parameters:
#             topic_names (list): List of topic names to consume data from.

#         Raises:
#             Exception: If an invalid list of topic names is provided (empty or not a list).
#         """
#         if (not isinstance(topic_names, list) or len(topic_names) <= 0):
#             # Ensure valid input for topic names
#             raise Exception("Insert valid topic names")

#         logger.info("Starting message processing for topics: %s", topic_names)

#         # Consume messages from the Kafka topics
#         for topic, key, value in self.kafka_consumer.consume_from_kafka(topic_names, self.__on_assign):
#             if value is None:
#                 continue

#             processing_start_time = time.time()
#             try:
#                 # Denormalize payload
#                 denorm_value = self.__denormalize_payload(value)
#                 response = {}
#                 record_did = "None" if not Utils.SSI_VALIDATION else (
#                     (cred := denorm_value.get("tradeCredential"))
#                     and (subj := cred.get("credentialSubject"))
#                     and subj.get("id")
#                 ) or "unknown"
#                 trade_event_id = denorm_value.get("trade_event_id", "unknown")
#                 if (Utils.SSI_VALIDATION):
#                     response = await self.veramo_client.verify_credential(denorm_value)

#                 # Log processing results
#                 print("\n" + "=" * 70)
#                 logger.info(f"Processed message from topic '{topic}'")
#                 logger.info(f"Trade Event id: '{trade_event_id}'")
#                 logger.info(f"DID: {record_did}")
#                 logger.info(f"Expects SSI Validation: {Utils.SSI_VALIDATION}")
#                 logger.info(
#                     f"Verification result: {response.get('verified', False)}")

#                 # Calculate and record end-to-end latency
#                 self._record_end_to_end_latency(denorm_value, trade_event_id)

#                 print("=" * 70 + "\n")

#                 # Record processing duration
#                 processing_duration = time.time() - processing_start_time
#                 self.metrics.labels(self.metrics.message_processing_duration,
#                                     did_provider=Utils.DID_PROVIDER, topic=topic).observe(processing_duration)

#             except Exception as e:
#                 processing_duration = time.time() - processing_start_time
#                 self.metrics.labels(self.metrics.message_processing_duration,
#                                     did_provider=Utils.DID_PROVIDER, topic=topic).observe(processing_duration)
#                 self.metrics.labels(self.metrics.processing_errors_total,
#                                     did_provider=Utils.DID_PROVIDER,
#                                     topic=topic,
#                                     error_type="processing_error"
#                                     ).inc()
#                 logger.error(
#                     f"Error processing message from topic '{topic}': {e}")

#     def _record_end_to_end_latency(self, denorm_value: Dict, trade_event_id: str) -> None:
#         """Calculate and record end-to-end latency metrics"""
#         try:
#             created_at_str = denorm_value.get("start_timestamp")
#             if created_at_str:
#                 created_at = datetime.fromisoformat(
#                     created_at_str.replace('Z', '+00:00'))
#                 now = datetime.now(timezone.utc)
#                 logger.info(f"Ingestion Time In UTC: {denorm_value.get("start_timestamp")}")
#                 logger.info(f"Current Time In UTC: {now}")

#                 latency = (now - created_at).total_seconds()
#                 self.metrics.labels(
#                     self.metrics.end_to_end_latency,
#                     did_provider=Utils.DID_PROVIDER,
#                 ).observe(latency)
#                 logger.info(
#                     f"End to end latency for event: {trade_event_id} with {
#                         "no" if not Utils.SSI_VALIDATION else ""
#                     } validation: {latency:.3f}s")
#             else:
#                 logger.warning(
#                     "No start_timestamp found in message for latency calculation")
#         except Exception as e:
#             logger.error(f"Failed to compute end-to-end latency: {e}")

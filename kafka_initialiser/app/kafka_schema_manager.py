from typing import Dict, List
import logging

from confluent_kafka.schema_registry import SchemaReference

from app.schema_loader import SchemaLoader
from app.schema_registry_manager import SchemaRegistryManager
from app.kafka_topic_manager import KafkaTopicManager
from app.constants import SchemaInfo

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class KafkaSchemaManager:
    """Main orchestrator for Kafka schema and topic management"""

    def __init__(self, schema_dir: str, schema_registry_url: str, bootstrap_servers: str):
        self.schema_loader = SchemaLoader(schema_dir)
        self.registry_manager = SchemaRegistryManager(schema_registry_url)
        self.topic_manager = KafkaTopicManager(bootstrap_servers)

    def setup_schemas(self, validate_only: bool = False) -> Dict[str, SchemaInfo]:
        """
        Complete schema setup process

        Args:
            validate_only: If True, only validate schemas without registering

        Returns:
            Dictionary of schema info objects
        """
        logger.info("Starting schema setup process")

        try:
            # Load and validate schemas
            schemas = self.schema_loader.load_schemas()

            if validate_only:
                logger.info("Validation complete. Schemas are valid.")
                return schemas

            # Analyze dependencies and compute build order
            self.schema_loader.analyze_dependencies()
            build_order = self.schema_loader.compute_build_order()

            # Register schemas in dependency order
            self._register_schemas_in_order(build_order)

            logger.info("Schema setup completed successfully")
            return schemas

        except Exception as e:
            logger.error(f"Schema setup failed: {e}")
            raise

    def _register_schemas_in_order(self, build_order: List[str]):
        """Register schemas in dependency order"""
        logger.info("Registering schemas in dependency order")

        for schema_fqn in build_order:
            schema_info = self.schema_loader.schemas[schema_fqn]
            references = self._build_schema_references(schema_info)

            try:
                self.registry_manager.register_schema(schema_info, references)
            except Exception as e:
                logger.error(f"Failed to register schema {schema_fqn}: {e}")
                raise

    def _build_schema_references(self, schema_info: SchemaInfo) -> List[SchemaReference]:
        """Build schema references for dependencies"""
        references = []

        for dep_fqn in sorted(schema_info.dependencies):
            if dep_fqn not in self.registry_manager.registry_cache:
                raise RuntimeError(f"Dependency {dep_fqn} not registered for {schema_info.fqn}")

            subject, version = self.registry_manager.registry_cache[dep_fqn]
            references.append(SchemaReference(
                name=dep_fqn,
                subject=subject,
                version=version
            ))

        return references

    def create_topics(self, topic_names: List[str], partitions: int = 1,
                     replication_factor: int = 1) -> Dict[str, bool]:
        """Create Kafka topics"""
        logger.info(f"Creating topics: {topic_names}")
        return self.topic_manager.create_topics(topic_names, partitions, replication_factor)

    def validate_schemas_only(self) -> bool:
        """Validate schemas without registration"""
        try:
            self.setup_schemas(validate_only=True)
            return True
        except Exception as e:
            logger.error(f"Schema validation failed: {e}")
            return False


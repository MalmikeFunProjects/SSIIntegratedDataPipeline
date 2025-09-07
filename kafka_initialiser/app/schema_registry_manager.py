import json
from typing import Dict, List, Tuple, Optional
import logging

from confluent_kafka.schema_registry import SchemaRegistryClient, Schema, SchemaReference
from confluent_kafka.schema_registry.error import SchemaRegistryError

from app.constants import SchemaInfo

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SchemaRegistryManager:
    """Handles schema registry operations"""

    def __init__(self, schema_registry_url: str):
        self.client = SchemaRegistryClient({"url": schema_registry_url})
        self.registry_cache: Dict[str, Tuple[str, int]] = {}  # FQN -> (subject, version)

    def register_schema(self, schema_info: SchemaInfo,
                       references: Optional[List[SchemaReference]] = None) -> int:
        """
        Register schema in registry with optional references
        Returns schema ID
        """
        try:
            subject_name = f"{schema_info.subject_name or schema_info.schema['name']}-value"

            print("\n\n")
            print("="*10+subject_name+"="*10)
            print(schema_info.schema)
            print("="*25)
            print("\n\n")

            schema = Schema(
                json.dumps(schema_info.schema),
                schema_type="AVRO",
                references=references or []
            )

            schema_id = self.client.register_schema(subject_name, schema=schema)
            latest = self.client.get_latest_version(subject_name)

            # Update cache and schema info
            self.registry_cache[schema_info.fqn] = (subject_name, latest.version)
            schema_info.subject_name = subject_name
            schema_info.version = latest.version
            schema_info.schema_id = schema_id

            logger.info(f"Registered schema {schema_info.fqn} → "
                       f"subject={subject_name}, version={latest.version}, id={schema_id}")

            return schema_id

        except SchemaRegistryError as e:
            logger.error(f"Schema registry error for {schema_info.fqn}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error registering {schema_info.fqn}: {e}")
            raise

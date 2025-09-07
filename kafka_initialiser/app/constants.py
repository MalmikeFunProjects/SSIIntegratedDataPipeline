from typing import Dict, Set, Optional, Any
from dataclasses import dataclass
from enum import Enum

class AvroType(Enum):
    """Avro type constants"""
    RECORD = "record"
    ENUM = "enum"
    FIXED = "fixed"
    ARRAY = "array"
    MAP = "map"
    UNION = "union"


AVRO_PRIMITIVES = {
    "null", "boolean", "int", "long", "float", "double", "bytes", "string"
}

AVRO_COMPLEX_TYPES = set({AvroType.RECORD.value, AvroType.ENUM.value, AvroType.FIXED.value})


@dataclass
class SchemaInfo:
    """Schema metadata container"""
    fqn: str
    schema: Dict[str, Any]
    file_path: str
    dependencies: Set[str]
    subject_name: Optional[str] = None
    version: Optional[int] = None
    schema_id: Optional[int] = None


class SchemaValidationError(Exception):
    """Custom exception for schema validation errors"""
    pass

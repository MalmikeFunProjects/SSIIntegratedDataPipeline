from collections import defaultdict, deque
import json
import os
from typing import Dict, List, Set, Optional, Any
import logging

from app.avro_schema_validator import AvroSchemaValidator
from app.constants import AVRO_COMPLEX_TYPES, AVRO_PRIMITIVES, AvroType, SchemaInfo, SchemaValidationError
from app.utilities import get_fully_qualified_name

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



class SchemaLoader:
    """Loads and manages Avro schema files with dependency resolution"""

    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        self.validator = AvroSchemaValidator()
        self.schemas: Dict[str, SchemaInfo] = {}
        self.dependency_graph: Dict[str, Set[str]] = {}
        self.build_order: List[str] = []

    def load_schemas(self) -> Dict[str, SchemaInfo]:
        """Load all .avsc files from base directory"""
        logger.info(f"Loading schemas from {self.base_dir}")

        schema_files = []
        for root, _, files in os.walk(self.base_dir):
            for file in files:
                if file.endswith(".avsc"):
                    schema_files.append(os.path.join(root, file))

        if not schema_files:
            raise RuntimeError(f"No .avsc files found in {self.base_dir}")

        for file_path in schema_files:
            self._load_single_schema(file_path)

        logger.info(f"Loaded {len(self.schemas)} schemas")
        return self.schemas

    def _load_single_schema(self, file_path: str):
        """Load and validate a single schema file"""
        try:
            with open(file_path, 'r') as f:
                schema_dict = json.load(f)

            # Validate schema
            self.validator.validate_schema(schema_dict, file_path)

            # Create schema info
            fqn = get_fully_qualified_name(
                schema_dict["name"],
                schema_dict.get("namespace")
            )

            if fqn in self.schemas:
                logger.warning(f"Duplicate schema FQN: {fqn}. Using {file_path}")

            schema_info = SchemaInfo(
                fqn=fqn,
                schema=schema_dict,
                file_path=file_path,
                dependencies=set()
            )

            self.schemas[fqn] = schema_info
            logger.debug(f"Loaded schema: {fqn} from {file_path}")

        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON in {file_path}: {e}")
        except SchemaValidationError:
            raise
        except Exception as e:
            raise RuntimeError(f"Error loading schema from {file_path}: {e}")

    def analyze_dependencies(self):
        """Analyze schema dependencies"""
        logger.info("Analyzing schema dependencies")

        for schema_info in self.schemas.values():
            deps = self._extract_dependencies(schema_info.schema, schema_info.fqn)
            # Only include dependencies that exist in our schema set
            schema_info.dependencies = {dep for dep in deps if dep in self.schemas}
            self.dependency_graph[schema_info.fqn] = schema_info.dependencies

        logger.info(f"Dependency analysis complete. Found {sum(len(deps) for deps in self.dependency_graph.values())} dependencies")

    def _extract_dependencies(self, schema: Dict[str, Any], schema_fqn: str) -> Set[str]:
        """Extract external type dependencies from schema"""
        namespace = schema.get("namespace")
        defined_types = {schema_fqn}  # Don't include self-references
        dependencies = set()

        # Extract type references
        self._extract_type_references(schema, namespace, dependencies)

        # Remove self-defined types
        dependencies -= defined_types

        return dependencies

    def _extract_type_references(self, node: Any, namespace: Optional[str], dependencies: Set[str]):
        """Extract type references from schema node"""
        if isinstance(node, str):
            # Named type reference
            if node not in AVRO_PRIMITIVES:
                dependencies.add(get_fully_qualified_name(node, namespace))

        elif isinstance(node, list):
            # Union type - process each member
            for union_member in node:
                self._extract_type_references(union_member, namespace, dependencies)

        elif isinstance(node, dict):
            node_type = node.get("type")

            # Handle string type references
            if isinstance(node_type, str):
                if node_type not in AVRO_PRIMITIVES and node_type not in AVRO_COMPLEX_TYPES:
                    # It's a named type reference
                    dependencies.add(get_fully_qualified_name(node_type, namespace))
                elif node_type == AvroType.RECORD.value:
                    # Process record fields
                    for field in node.get("fields", []):
                        self._extract_type_references(field.get("type"),
                                                    node.get("namespace", namespace), dependencies)

            # Handle complex type as dict (e.g., "type": {"type": "array", "items": "string"})
            elif isinstance(node_type, dict):
                self._extract_type_references(node_type, namespace, dependencies)

            # Handle union type as list (e.g., "type": ["null", "string"])
            elif isinstance(node_type, list):
                for union_member in node_type:
                    self._extract_type_references(union_member, namespace, dependencies)

            # Handle specific complex types by their structure
            if node_type == AvroType.ARRAY.value or (isinstance(node, dict) and "items" in node):
                self._extract_type_references(node.get("items"), namespace, dependencies)
            elif node_type == AvroType.MAP.value or (isinstance(node, dict) and "values" in node):
                self._extract_type_references(node.get("values"), namespace, dependencies)

            # Recurse into other properties (avoiding double-processing)
            for key, value in node.items():
                if key not in {"type", "items", "values", "fields"}:  # Skip already processed fields
                    self._extract_type_references(value, namespace, dependencies)

    def compute_build_order(self) -> List[str]:
        """Compute topological order for schema registration"""
        logger.info("Computing schema build order")

        if not self.dependency_graph:
            self.analyze_dependencies()

        # Kahn's algorithm for topological sorting
        in_degree = defaultdict(int)
        for node in self.dependency_graph:
            in_degree[node] = 0

        for node, deps in self.dependency_graph.items():
            for dep in deps:
                in_degree[node] += 1

        queue = deque([node for node, degree in in_degree.items() if degree == 0])
        build_order = []

        while queue:
            current = queue.popleft()
            build_order.append(current)

            # Update in-degrees of dependents
            for node, deps in self.dependency_graph.items():
                if current in deps:
                    in_degree[node] -= 1
                    if in_degree[node] == 0:
                        queue.append(node)

        if len(build_order) != len(self.schemas):
            cycles = set(self.schemas.keys()) - set(build_order)
            raise RuntimeError(f"Circular dependencies detected in schemas: {cycles}")

        self.build_order = build_order
        logger.info(f"Build order computed: {len(build_order)} schemas")
        return build_order

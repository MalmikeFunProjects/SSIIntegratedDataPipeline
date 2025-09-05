package veramo

import (
	"regexp"
	"strings"
)

var (
	// replace anything NOT a-z, 0-9, dot, dash, underscore with "-"
	nonAllowed = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)
	// collapse multiple "-" into one
	dashRun = regexp.MustCompile(`-+`)
)

func sanitizeSegment(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// replace disallowed chars with "-"
	s = nonAllowed.ReplaceAllString(s, "-")
	// collapse runs of "-" to a single "-"
	s = dashRun.ReplaceAllString(s, "-")
	// trim leading/trailing "-"
	return strings.Trim(s, "-")
}

// createDidWebURL constructs a DID web URL from host, project, and entity components
// Returns a properly formatted did:web: URL with sanitized segments
func CreateDidWebAlias(didWebHost, didWebProject, didEntityName string) string {
	// Normalize host: remove scheme, trailing slash, convert to lowercase
	host := strings.TrimSpace(didWebHost)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")
	host = sanitizeSegment(host)

	segments := []string{host}

	// Process project path: split by ":" or "/" and sanitize each non-empty part
	if project := strings.TrimSpace(didWebProject); project != "" {
		projectParts := strings.FieldsFunc(project, func(r rune) bool {
			return r == ':' || r == '/'
		})

		for _, part := range projectParts {
			if sanitized := sanitizeSegment(part); sanitized != "" {
				segments = append(segments, sanitized)
			}
		}
	}

	// Add entity segment
	if entity := sanitizeSegment(didEntityName); entity != "" {
		segments = append(segments, entity)
	}

	return strings.Join(segments, ":")
}

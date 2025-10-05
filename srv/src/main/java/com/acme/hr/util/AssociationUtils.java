package com.acme.hr.util;

import java.util.HashMap;
import java.util.Map;

/**
 * Helper utilities for dealing with CDS association maps.
 */
public final class AssociationUtils {

    private AssociationUtils() {
    }

    public static boolean isAssociationProvided(Map<String, Object> entry, String associationName) {
        return entry.containsKey(associationName + "_ID") || entry.containsKey(associationName);
    }

    public static String extractEntryId(Map<String, Object> entry) {
        Object idValue = entry.get("ID");
        if (idValue instanceof String id && !id.isBlank()) {
            return id;
        }

        idValue = entry.get("Id");
        if (idValue instanceof String mixedCaseId && !mixedCaseId.isBlank()) {
            return mixedCaseId;
        }

        idValue = entry.get("id");
        if (idValue instanceof String lowerCaseId && !lowerCaseId.isBlank()) {
            return lowerCaseId;
        }

        return null;
    }

    public static void setAssociationId(Map<String, Object> entry, String associationName, String value) {
        entry.put(associationName + "_ID", value);

        Object existing = entry.get(associationName);
        if (existing instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> association = (Map<String, Object>) existing;
            association.put("ID", value);
        } else if (existing == null && value != null) {
            Map<String, Object> association = new HashMap<>();
            association.put("ID", value);
            entry.put(associationName, association);
        }
    }

    public static String extractAssociationId(Map<String, Object> entry, String associationName) {
        Object direct = entry.get(associationName + "_ID");
        if (direct instanceof String directId && !directId.isBlank()) {
            return directId;
        }

        Object association = entry.get(associationName);
        if (association instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> associationMap = (Map<String, Object>) association;
            Object nestedId = associationMap.get("ID");
            if (nestedId instanceof String nested && !nested.isBlank()) {
                return nested;
            }
        }
        return null;
    }
}

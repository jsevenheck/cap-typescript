package com.acme.hr.services;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.sap.cds.Struct;
import com.sap.cds.services.ErrorStatuses;
import com.sap.cds.services.ServiceException;
import com.sap.cds.services.cds.CdsUpdateEventContext;

import cds.gen.clientservice.Clients;

import static com.acme.hr.util.AssociationUtils.isAssociationProvided;

/**
 * Encapsulates mapping and validation logic for client operations.
 */
public class ClientServiceLogic {

    private static final Logger logger = LoggerFactory.getLogger(ClientServiceLogic.class);

    public List<Clients> mapEntries(List<Map<String, Object>> entries) {
        if (entries == null || entries.isEmpty()) {
            return Collections.emptyList();
        }

        List<Clients> clients = new ArrayList<>(entries.size());
        for (Map<String, Object> entry : entries) {
            clients.add(Struct.access(entry).as(Clients.class));
        }
        return clients;
    }

    public List<Map<String, Object>> collectUpdateEntries(CdsUpdateEventContext context) {
        List<Map<String, Object>> entries = new ArrayList<>();
        if (context == null) {
            return entries;
        }

        Iterable<Map<String, Object>> valueSets = context.getCqnValueSets();
        if (valueSets != null) {
            for (Map<String, Object> values : valueSets) {
                entries.add(values);
            }
        } else if (context.getCqn() != null && context.getCqn().data() != null) {
            entries.add(context.getCqn().data());
        }
        return entries;
    }

    public void validateClients(List<Clients> clients, List<Map<String, Object>> rawEntries, String operation) {
        boolean isCreate = "create".equalsIgnoreCase(operation);

        for (int i = 0; i < clients.size(); i++) {
            Clients client = clients.get(i);
            Map<String, Object> raw = (rawEntries != null && i < rawEntries.size())
                    ? rawEntries.get(i)
                    : Collections.emptyMap();

            boolean companyProvided = raw.containsKey("companyId") || raw.containsKey("company_ID");
            boolean nameProvided = raw.containsKey("name");
            boolean countryProvided = isAssociationProvided(raw, "country")
                    || raw.containsKey("country_code");

            if (isCreate || companyProvided) {
                if (client.getCompanyId() == null || client.getCompanyId().isBlank()) {
                    logger.debug("Validation failed during {}: missing companyId", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Company ID must not be empty.");
                }
            }

            if (isCreate || nameProvided) {
                if (client.getName() == null || client.getName().isBlank()) {
                    logger.debug("Validation failed during {}: missing name", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Name must not be empty.");
                }
            }

            if (isCreate || countryProvided) {
                String countryCode = determineCountryCode(client, raw);
                if (countryCode == null || countryCode.isBlank()) {
                    logger.debug("Validation failed during {}: missing country", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Country must be provided.");
                }
            }
        }
    }

    private String determineCountryCode(Clients client, Map<String, Object> raw) {
        if (raw != null) {
            Object direct = raw.get("country_code");
            if (direct instanceof String directCode && !directCode.isBlank()) {
                return directCode;
            }

            Object fk = raw.get("country_ID");
            if (fk instanceof String fkValue && !fkValue.isBlank()) {
                return fkValue;
            }

            Object association = raw.get("country");
            if (association instanceof Map<?, ?> associationMap) {
                Object nestedCode = associationMap.get("code");
                if (nestedCode instanceof String code && !code.isBlank()) {
                    return code;
                }
                Object nestedId = associationMap.get("ID");
                if (nestedId instanceof String nested && !nested.isBlank()) {
                    return nested;
                }
            }
        }

        return null;
    }
}

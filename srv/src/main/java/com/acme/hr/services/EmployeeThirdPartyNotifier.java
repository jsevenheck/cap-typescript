package com.acme.hr.services;

import static com.acme.hr.util.AssociationUtils.extractAssociationId;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sap.cds.Result;
import com.sap.cds.Row;
import com.sap.cds.ql.Select;
import com.sap.cds.ql.cqn.CqnSelect;
import com.sap.cds.services.ErrorStatuses;
import com.sap.cds.services.ServiceException;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.clientservice.Clients_;

/**
 * Sends newly created employee payloads to the configured third-party endpoint.
 */
@Component
public class EmployeeThirdPartyNotifier {

    private static final Logger logger = LoggerFactory.getLogger(EmployeeThirdPartyNotifier.class);
    private static final Duration HTTP_TIMEOUT = Duration.ofSeconds(10);

    private final PersistenceService persistenceService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public EmployeeThirdPartyNotifier(PersistenceService persistenceService, ObjectMapper objectMapper) {
        this.persistenceService = persistenceService;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(HTTP_TIMEOUT)
                .build();
    }

    public PreparedNotification prepareEmployeesCreated(List<Map<String, Object>> requestEntries, List<Row> persistedRows) {
        if (requestEntries == null || requestEntries.isEmpty()) {
            logger.debug("No employee entries available for third-party notification.");
            return PreparedNotification.empty();
        }

        URI endpoint = resolveEndpoint();
        if (endpoint == null) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                    "Third-party employee endpoint is not configured. Set the THIRD_PARTY_EMPLOYEE_ENDPOINT environment variable or the thirdparty.employee.endpoint system property.");
        }

        List<Map<String, Object>> payloads = new ArrayList<>(requestEntries.size());
        List<Row> persisted = persistedRows != null ? new ArrayList<>(persistedRows) : Collections.emptyList();

        for (int index = 0; index < requestEntries.size(); index++) {
            Map<String, Object> entry = requestEntries.get(index);
            Map<String, Object> payload = entry != null ? new LinkedHashMap<>(entry) : new LinkedHashMap<>();

            if (index < persisted.size()) {
                mergePersistedValues(payload, persisted.get(index));
            }

            enrichWithCompanyId(payload);
            payloads.add(payload);
        }

        return new PreparedNotification(endpoint, payloads);
    }

    public void sendPreparedNotification(PreparedNotification notification) {
        if (notification == null || notification.isEmpty()) {
            logger.debug("Skipping third-party employee notification because the prepared payload is empty.");
            return;
        }

        List<CompletableFuture<Void>> deliveries = new ArrayList<>(notification.getPayloads().size());
        for (Map<String, Object> payload : notification.getPayloads()) {
            deliveries.add(sendToEndpointAsync(notification.getEndpoint(), payload));
        }

        CompletableFuture<Void> aggregate = CompletableFuture
                .allOf(deliveries.toArray(CompletableFuture[]::new));
        try {
            aggregate.join();
        } catch (CompletionException ex) {
            throw unwrapServiceException(ex);
        }
    }

    private URI resolveEndpoint() {
        String url = System.getProperty("thirdparty.employee.endpoint");
        if (url == null || url.isBlank()) {
            url = System.getenv("THIRD_PARTY_EMPLOYEE_ENDPOINT");
        }
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI endpoint = URI.create(url);
            String scheme = endpoint.getScheme();
            if (scheme == null || !"https".equalsIgnoreCase(scheme)) {
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Third-party employee endpoint must use HTTPS.");
            }
            return endpoint;
        } catch (IllegalArgumentException ex) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                    "Invalid third-party employee endpoint configured: " + ex.getMessage(), ex);
        }
    }

    private void mergePersistedValues(Map<String, Object> payload, Row row) {
        copyIfAbsent(payload, "ID", row.get("ID"));
        copyIfAbsent(payload, "client_ID", row.get("client_ID"));
        copyIfAbsent(payload, "manager_ID", row.get("manager_ID"));
        copyIfAbsent(payload, "costCenter_ID", row.get("costCenter_ID"));
        copyIfAbsent(payload, "createdAt", row.get("createdAt"));
        copyIfAbsent(payload, "createdBy", row.get("createdBy"));
        copyIfAbsent(payload, "modifiedAt", row.get("modifiedAt"));
        copyIfAbsent(payload, "modifiedBy", row.get("modifiedBy"));
    }

    private void copyIfAbsent(Map<String, Object> payload, String key, Object value) {
        if (!payload.containsKey(key) && value != null) {
            payload.put(key, value);
        }
    }

    private void enrichWithCompanyId(Map<String, Object> payload) {
        String clientId = extractAssociationId(payload, "client");
        if (clientId == null || clientId.isBlank()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                    "Employee payload must contain a client reference.");
        }

        String companyId = fetchCompanyId(clientId);
        payload.put("companyId", companyId);
    }

    private String fetchCompanyId(String clientId) {
        CqnSelect select = Select.from(Clients_.class)
                .columns(c -> c.ID(), c -> c.companyId())
                .byId(clientId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Referenced client does not exist.");
        }

        Object companyId = row.get().get("companyId");
        if (companyId instanceof String value && !value.isBlank()) {
            return value;
        }

        throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Client is missing a company ID.");
    }

    private CompletableFuture<Void> sendToEndpointAsync(URI endpoint, Map<String, Object> payload) {
        String body;
        try {
            body = objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                    "Failed to serialise employee payload for third-party notification.", e);
        }

        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .header("Content-Type", "application/json")
                .timeout(HTTP_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    int status = response.statusCode();
                    if (status < 200 || status >= 300) {
                        throw new ServiceException(ErrorStatuses.BAD_GATEWAY,
                                String.format("Third-party endpoint %s responded with status %d", endpoint, status));
                    }
                    logger.debug("Sent employee payload to third-party endpoint {} with status {}", endpoint, status);
                })
                .exceptionally(throwable -> {
                    throw unwrapServiceException(throwable);
                });
    }

    private ServiceException unwrapServiceException(Throwable throwable) {
        if (throwable instanceof CompletionException completion && completion.getCause() != null) {
            return unwrapServiceException(completion.getCause());
        }
        if (throwable instanceof ServiceException serviceException) {
            return serviceException;
        }
        if (throwable instanceof IOException ioException) {
            return new ServiceException(ErrorStatuses.BAD_GATEWAY,
                    "Failed to invoke third-party employee endpoint.", ioException);
        }
        return new ServiceException(ErrorStatuses.BAD_GATEWAY,
                "Third-party employee notification failed.", throwable);
    }

    public static final class PreparedNotification {
        private final URI endpoint;
        private final List<Map<String, Object>> payloads;

        private PreparedNotification(URI endpoint, List<Map<String, Object>> payloads) {
            this.endpoint = endpoint;
            this.payloads = payloads == null ? Collections.emptyList() : Collections.unmodifiableList(payloads);
        }

        public static PreparedNotification empty() {
            return new PreparedNotification(null, Collections.emptyList());
        }

        public boolean isEmpty() {
            return payloads.isEmpty();
        }

        public URI getEndpoint() {
            return endpoint;
        }

        public List<Map<String, Object>> getPayloads() {
            return payloads;
        }
    }
}


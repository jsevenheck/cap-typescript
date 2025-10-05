package com.acme.hr.services;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.hr.services.model.CostCenterMetadata;
import com.acme.hr.services.model.EmployeeMetadata;
import com.sap.cds.Result;
import com.sap.cds.Row;
import com.sap.cds.ql.Insert;
import com.sap.cds.ql.Select;
import com.sap.cds.ql.Update;
import com.sap.cds.ql.cqn.CqnSelect;
import com.sap.cds.services.ErrorStatuses;
import com.sap.cds.services.ServiceException;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.clientmgmt.EmployeeIdCounters;
import cds.gen.clientmgmt.EmployeeIdCounters_;
import cds.gen.clientservice.Clients;
import cds.gen.clientservice.Clients_;
import cds.gen.clientservice.Employees;
import cds.gen.clientservice.Employees_;

/**
 * Repository for employee metadata operations.
 */
public class EmployeeRepository {

    private static final Logger logger = LoggerFactory.getLogger(EmployeeRepository.class);
    private static final int MAX_EMPLOYEE_ID_RESERVATION_ATTEMPTS = 5;
    public static final int MAX_EMPLOYEE_ID_LENGTH = 60;

    private final PersistenceService persistenceService;
    private final CostCenterRepository costCenterRepository;

    public EmployeeRepository(PersistenceService persistenceService, CostCenterRepository costCenterRepository) {
        this.persistenceService = persistenceService;
        this.costCenterRepository = costCenterRepository;
    }

    public CostCenterMetadata findAssignedCostCenterMetadata(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.ID(), e -> e.costCenter_ID())
                .byId(employeeId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Employee {} not found when loading assigned cost center", employeeId);
            return null;
        }

        String existingCostCenterId = row.map(r -> r.get("costCenter_ID")).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
        if (existingCostCenterId == null || existingCostCenterId.isBlank()) {
            return null;
        }

        return costCenterRepository.findMetadata(existingCostCenterId);
    }

    public LocalDate findEntryDate(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.ID(), e -> e.entryDate())
                .byId(employeeId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Employee {} not found when loading entry date", employeeId);
            return null;
        }

        Object entryDateValue = row.map(r -> r.get(Employees.ENTRY_DATE)).orElse(null);
        if (entryDateValue instanceof LocalDate) {
            return (LocalDate) entryDateValue;
        }
        if (entryDateValue instanceof java.sql.Date sqlDate) {
            return sqlDate.toLocalDate();
        }
        return null;
    }

    public LocalDate findExitDate(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.ID(), e -> e.exitDate())
                .byId(employeeId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Employee {} not found when loading exit date", employeeId);
            return null;
        }

        Object exitDateValue = row.map(r -> r.get(Employees.EXIT_DATE)).orElse(null);
        if (exitDateValue instanceof LocalDate) {
            return (LocalDate) exitDateValue;
        }
        if (exitDateValue instanceof java.sql.Date sqlDate) {
            return sqlDate.toLocalDate();
        }
        return null;
    }

    public String findEmployeeId(String employeeRecordId) {
        if (employeeRecordId == null || employeeRecordId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.employeeId())
                .byId(employeeRecordId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Employee {} not found when loading employeeId", employeeRecordId);
            return null;
        }

        return row.map(r -> r.get(Employees.EMPLOYEE_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
    }

    public String findEmployeeIdByBusinessKey(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.employeeId())
                .where(e -> e.employeeId().eq(employeeId));
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Employee {} not found when loading by business key", employeeId);
            return null;
        }

        return row.map(r -> r.get(Employees.EMPLOYEE_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
    }

    public EmployeeMetadata requireEmployeeMetadata(String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee reference is required.");
        }

        CqnSelect select = Select.from(Employees_.class)
                .columns(e -> e.ID(), e -> e.client_ID())
                .byId(employeeId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Referenced employee does not exist.");
        }

        String clientId = row.map(r -> r.get(Employees_.CLIENT_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
        if (clientId == null || clientId.isBlank()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee must belong to a client.");
        }

        return new EmployeeMetadata(employeeId, clientId);
    }

    public EmployeeIdSeed loadEmployeeIdSeed(String clientId, int allocationSize) {
        if (clientId == null || clientId.isBlank()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Client reference is required to assign an employee ID.");
        }

        if (allocationSize <= 0) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "At least one employee must be provided to reserve an ID.");
        }

        CqnSelect clientSelect = Select.from(Clients_.class)
                .columns(c -> c.companyId())
                .byId(clientId);
        Result clientResult = persistenceService.run(clientSelect);

        Optional<Row> clientRow = clientResult.first();
        if (clientRow.isEmpty()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Referenced client does not exist.");
        }

        String companyId = clientRow.map(r -> r.get(Clients.COMPANY_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
        if (companyId != null) {
            companyId = companyId.trim();
        }
        if (companyId == null || companyId.isBlank()) {
            throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Client must have a company ID.");
        }

        for (int attempt = 0; attempt < MAX_EMPLOYEE_ID_RESERVATION_ATTEMPTS; attempt++) {
            Optional<Row> counterRow = fetchEmployeeIdCounter(clientId);
            if (counterRow.isPresent()) {
                Integer lastCounter = extractCounter(counterRow.get());
                int currentCounter = lastCounter != null ? lastCounter.intValue() : 0;
                int newLastCounter = currentCounter + allocationSize;

                Map<String, Object> data = new HashMap<>();
                data.put(EmployeeIdCounters.LAST_COUNTER, newLastCounter);

                Result updateResult = persistenceService.run(Update.entity(EmployeeIdCounters_.class)
                        .data(data)
                        .where(c -> c.client_ID().eq(clientId).and(c.lastCounter().eq(currentCounter))));

                if (updateResult.rowCount() == 1) {
                    return new EmployeeIdSeed(companyId, currentCounter + 1);
                }

                logger.debug("Retrying employee ID reservation for client {} because counter was updated concurrently",
                        clientId);
                continue;
            }

            int existingMax = findExistingMaxCounter(clientId, companyId);
            int newLastCounter = existingMax + allocationSize;

            Map<String, Object> insertData = new HashMap<>();
            insertData.put(EmployeeIdCounters.CLIENT_ID, clientId);
            insertData.put(EmployeeIdCounters.LAST_COUNTER, newLastCounter);

            try {
                persistenceService.run(Insert.into(EmployeeIdCounters_.class).entry(insertData));
                return new EmployeeIdSeed(companyId, existingMax + 1);
            } catch (RuntimeException ex) {
                if (isUniqueConstraintViolation(ex)) {
                    logger.debug("Detected concurrent employee ID counter creation for client {}. Retrying.", clientId);
                    continue;
                }
                throw ex;
            }
        }

        logger.error("Exceeded retry limit while reserving employee ID for client {}", clientId);
        throw new ServiceException(ErrorStatuses.SERVER_ERROR,
                "Unable to generate a unique employee ID. Please retry the request.");
    }

    private Integer parseCounter(String expectedPrefix, String employeeId) {
        if (employeeId == null || employeeId.isBlank()) {
            return null;
        }

        int separatorIndex = employeeId.lastIndexOf('-');
        if (separatorIndex <= 0) {
            logger.debug("Skipping employee ID {} due to missing separator", employeeId);
            return null;
        }

        String prefix = employeeId.substring(0, separatorIndex);
        if (!expectedPrefix.equals(prefix)) {
            logger.debug("Skipping employee ID {} due to prefix mismatch (expected {}, got {})", employeeId,
                    expectedPrefix, prefix);
            return null;
        }

        String counterPart = employeeId.substring(separatorIndex + 1);
        try {
            return Integer.parseInt(counterPart);
        } catch (NumberFormatException ex) {
            logger.debug("Skipping employee ID {} due to non-numeric counter {}", employeeId, counterPart);
            return null;
        }
    }

    private Optional<Row> fetchEmployeeIdCounter(String clientId) {
        CqnSelect select = Select.from(EmployeeIdCounters_.class)
                .columns(c -> c.client_ID(), c -> c.lastCounter())
                .byId(clientId);
        Result result = persistenceService.run(select);
        return result.first();
    }

    private Integer extractCounter(Row row) {
        if (row == null) {
            return null;
        }

        Object value = row.get(EmployeeIdCounters.LAST_COUNTER);
        if (value instanceof Integer integer) {
            return integer;
        }
        if (value instanceof Long longValue) {
            return Math.toIntExact(longValue);
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return null;
    }

    private int findExistingMaxCounter(String clientId, String companyId) {
        if (companyId == null || companyId.isBlank()) {
            return 0;
        }

        String normalizedCompanyId = companyId.trim();
        String prefixWithSeparator = normalizedCompanyId + "-";
        String sanitizedPrefix = prefixWithSeparator.replace("'", "''");
        int prefixLength = prefixWithSeparator.length();
        String prefixOrdering = String.format(
                "CASE WHEN SUBSTRING(employeeId, 1, %d) = '%s' THEN 0 ELSE 1 END",
                prefixLength, sanitizedPrefix);
        String lengthOrdering = String.format(
                "CASE WHEN SUBSTRING(employeeId, 1, %d) = '%s' THEN LENGTH(employeeId) ELSE 0 END DESC",
                prefixLength, sanitizedPrefix);
        CqnSelect relevantEmployees = Select.from(Employees_.class)
                .columns(e -> e.employeeId())
                .where(e -> e.client_ID().eq(clientId))
                .orderBy(prefixOrdering, lengthOrdering, "employeeId DESC");

        Result result = persistenceService.run(relevantEmployees);
        List<Row> rows = result.list();
        for (Row row : rows) {
            Object value = row.get(Employees.EMPLOYEE_ID);
            String existingId = (value instanceof String id) ? id : null;
            Integer parsed = parseCounter(companyId, existingId);
            if (parsed != null) {
                return parsed;
            }
        }

        return 0;
    }

    private boolean isUniqueConstraintViolation(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            String message = current.getMessage();
            if (message != null && message.toLowerCase(Locale.ROOT).contains("unique")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    public static final class EmployeeIdSeed {
        private final String companyId;
        private final int nextCounter;

        public EmployeeIdSeed(String companyId, int nextCounter) {
            this.companyId = companyId != null ? companyId.trim() : null;
            this.nextCounter = Math.max(nextCounter, 1);
        }

        public String companyId() {
            return companyId;
        }

        public int nextCounter() {
            return nextCounter;
        }
    }
}

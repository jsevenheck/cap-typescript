package com.acme.hr.services;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.hr.services.EmployeeRepository.EmployeeIdSeed;
import com.acme.hr.services.model.CostCenterMetadata;
import com.sap.cds.Struct;
import com.sap.cds.services.ErrorStatuses;
import com.sap.cds.services.ServiceException;
import com.sap.cds.services.cds.CdsUpdateEventContext;

import cds.gen.clientservice.Employees;

import static com.acme.hr.util.AssociationUtils.extractAssociationId;
import static com.acme.hr.util.AssociationUtils.extractEntryId;
import static com.acme.hr.util.AssociationUtils.isAssociationProvided;
import static com.acme.hr.util.AssociationUtils.setAssociationId;

/**
 * Business logic related to employee payload handling and validation.
 */
public class EmployeeServiceLogic {

    private static final Logger logger = LoggerFactory.getLogger(EmployeeServiceLogic.class);
    private static final int EMPLOYEE_ID_MAX_LENGTH = EmployeeRepository.MAX_EMPLOYEE_ID_LENGTH;
    private static final String EMPLOYEE_ID_FORMAT = "%s-%04d";

    private final CostCenterRepository costCenterRepository;
    private final EmployeeRepository employeeRepository;

    public EmployeeServiceLogic(CostCenterRepository costCenterRepository, EmployeeRepository employeeRepository) {
        this.costCenterRepository = costCenterRepository;
        this.employeeRepository = employeeRepository;
    }

    public List<Employees> mapEntries(List<Map<String, Object>> entries) {
        if (entries == null || entries.isEmpty()) {
            return Collections.emptyList();
        }

        List<Employees> employees = new ArrayList<>(entries.size());
        for (Map<String, Object> entry : entries) {
            employees.add(Struct.access(entry).as(Employees.class));
        }
        return employees;
    }

    public List<Map<String, Object>> collectUpdateEntries(CdsUpdateEventContext context) {
        List<Map<String, Object>> entries = new ArrayList<>();

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

    public void applyCostCenterRules(List<Map<String, Object>> entries, String operation) {
        for (Map<String, Object> entry : entries) {
            if (entry == null) {
                continue;
            }

            boolean costCenterAssociationProvided = isAssociationProvided(entry, "costCenter");
            String costCenterId = extractAssociationId(entry, "costCenter");

            CostCenterMetadata metadata = null;
            boolean costCenterIdProvided = costCenterId != null && !costCenterId.isBlank();

            if (costCenterAssociationProvided && !costCenterIdProvided) {
                // Explicitly clearing the cost center – nothing to enforce.
                continue;
            }

            if (costCenterIdProvided) {
                metadata = costCenterRepository.findMetadata(costCenterId);
                if (metadata == null) {
                    logger.debug("Validation failed during {}: unknown cost center {}", operation, costCenterId);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Assigned cost center does not exist.");
                }
            } else {
                String managerId = extractAssociationId(entry, "manager");
                if (managerId == null || managerId.isBlank()) {
                    continue;
                }

                String employeeId = extractEntryId(entry);
                if (employeeId == null || employeeId.isBlank()) {
                    logger.debug("Validation failed during {}: missing employee key for manager update", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Employees assigned to a cost center must use the responsible employee as their manager.");
                }

                metadata = employeeRepository.findAssignedCostCenterMetadata(employeeId);
                if (metadata == null) {
                    continue;
                }

                if (!managerId.equals(metadata.responsibleId())) {
                    logger.debug(
                            "Validation failed during {}: manager {} does not match responsible {} for cost center {}",
                            operation, managerId, metadata.responsibleId(), metadata.id());
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Employees assigned to a cost center must use the responsible employee as their manager.");
                }
            }

            String employeeClientId = extractAssociationId(entry, "client");
            if (employeeClientId == null || employeeClientId.isBlank()) {
                setAssociationId(entry, "client", metadata.clientId());
                employeeClientId = metadata.clientId();
            }

            if (!metadata.clientId().equals(employeeClientId)) {
                logger.debug("Validation failed during {}: cost center {} belongs to different client", operation,
                        metadata.id());
                throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center belongs to a different client.");
            }

            String managerId = extractAssociationId(entry, "manager");
            if (managerId == null || managerId.isBlank() || !managerId.equals(metadata.responsibleId())) {
                setAssociationId(entry, "manager", metadata.responsibleId());
            }
        }
    }

    public void validateEmployees(List<Employees> employees, List<Map<String, Object>> rawEntries, String operation) {
        boolean isCreate = "create".equalsIgnoreCase(operation);

        for (int i = 0; i < employees.size(); i++) {
            Employees employee = employees.get(i);
            Map<String, Object> raw = (rawEntries != null && i < rawEntries.size())
                    ? rawEntries.get(i)
                    : Collections.emptyMap();

            String employeeRecordId = employee.getId();
            if ((employeeRecordId == null || employeeRecordId.isBlank()) && raw != null) {
                employeeRecordId = extractEntryId(raw);
            }

            Object rawEmployeeIdValue = raw.get("employeeId");
            String rawEmployeeId = rawEmployeeIdValue != null ? rawEmployeeIdValue.toString().trim() : null;

            boolean needsPersistedEmployeeIdLookup = !isCreate
                    && (raw.containsKey("employeeId")
                            || employee.getEmployeeId() == null
                            || employee.getEmployeeId().isBlank());

            String persistedEmployeeId = null;
            if (needsPersistedEmployeeIdLookup && employeeRecordId != null && !employeeRecordId.isBlank()) {
                persistedEmployeeId = employeeRepository.findEmployeeId(employeeRecordId);
            }
            if (needsPersistedEmployeeIdLookup
                    && (persistedEmployeeId == null || persistedEmployeeId.isBlank())) {
                String lookupEmployeeId = employee.getEmployeeId();
                if (lookupEmployeeId == null || lookupEmployeeId.isBlank()) {
                    lookupEmployeeId = rawEmployeeId;
                }
                if (lookupEmployeeId != null && !lookupEmployeeId.isBlank()) {
                    persistedEmployeeId = employeeRepository.findEmployeeIdByBusinessKey(lookupEmployeeId.trim());
                }
            }

            if (!isCreate && raw.containsKey("employeeId")) {
                if (rawEmployeeId == null || rawEmployeeId.isBlank()) {
                    logger.debug("Validation failed during {}: empty employeeId provided in payload", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee ID must not be empty.");
                }

                if (persistedEmployeeId == null || persistedEmployeeId.isBlank()) {
                    logger.debug(
                            "Validation failed during {}: unable to resolve existing employee for employeeId enforcement",
                            operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee ID cannot be modified.");
                }

                String comparisonEmployeeId = persistedEmployeeId.trim();

                if (!comparisonEmployeeId.equals(rawEmployeeId)) {
                    logger.debug("Validation failed during {}: attempt to modify employeeId", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee ID cannot be modified.");
                }
            }

            String resolvedEmployeeId = employee.getEmployeeId();
            if (resolvedEmployeeId == null || resolvedEmployeeId.isBlank()) {
                resolvedEmployeeId = persistedEmployeeId;
            }
            if (resolvedEmployeeId != null) {
                resolvedEmployeeId = resolvedEmployeeId.trim();
            }

            if (resolvedEmployeeId == null || resolvedEmployeeId.isBlank()) {
                logger.debug("Validation failed during {}: missing employeeId", operation);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee ID must not be empty.");
            }
            if (isCreate || raw.containsKey("firstName")) {
                if (employee.getFirstName() == null || employee.getFirstName().isBlank()) {
                    logger.debug("Validation failed during {}: missing firstName", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "First name must not be empty.");
                }
            }
            if (isCreate || raw.containsKey("lastName")) {
                if (employee.getLastName() == null || employee.getLastName().isBlank()) {
                    logger.debug("Validation failed during {}: missing lastName", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Last name must not be empty.");
                }
            }
            if (isCreate || raw.containsKey("email")) {
                if (employee.getEmail() == null || employee.getEmail().isBlank()) {
                    logger.debug("Validation failed during {}: missing email", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Email must not be empty.");
                }
            }

            boolean entryDateProvided = raw.containsKey("entryDate");
            boolean exitDateProvided = raw.containsKey("exitDate");
            boolean statusProvided = raw.containsKey("status");
            boolean employmentTypeProvided = raw.containsKey("employmentType");

            LocalDate entryDate = employee.getEntryDate();
            LocalDate exitDate = employee.getExitDate();
            String status = employee.getStatus();
            String employmentType = employee.getEmploymentType();

            if (isCreate || entryDateProvided) {
                if (entryDate == null) {
                    logger.debug("Validation failed during {}: missing entry date", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Entry date must not be empty.");
                }
            }

            if (isCreate || statusProvided) {
                if (status == null || status.isBlank()) {
                    logger.debug("Validation failed during {}: missing status", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Status must not be empty.");
                }
            }

            if (isCreate || employmentTypeProvided) {
                if (employmentType == null || employmentType.isBlank()) {
                    logger.debug("Validation failed during {}: missing employment type", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employment type must not be empty.");
                }
            }

            LocalDate effectiveEntryDate = entryDate;
            if (exitDate != null) {
                if (effectiveEntryDate == null && !isCreate) {
                    if (employeeRecordId != null && !employeeRecordId.isBlank()) {
                        LocalDate persistedEntryDate = employeeRepository.findEntryDate(employeeRecordId);
                        if (persistedEntryDate != null) {
                            effectiveEntryDate = persistedEntryDate;
                        }
                    }
                }

                if (effectiveEntryDate != null && exitDate.isBefore(effectiveEntryDate)) {
                    logger.debug("Validation failed during {}: exit date {} before entry date {}", operation, exitDate,
                            effectiveEntryDate);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Exit date must be on or after the entry date.");
                }
            }

            boolean requiresExitDateValidation = isCreate || statusProvided || exitDateProvided;
            LocalDate effectiveExitDate = exitDate;
            if (effectiveExitDate == null && requiresExitDateValidation && !isCreate
                    && employeeRecordId != null && !employeeRecordId.isBlank()) {
                LocalDate persistedExitDate = employeeRepository.findExitDate(employeeRecordId);
                if (persistedExitDate != null) {
                    effectiveExitDate = persistedExitDate;
                }
            }

            if ("inactive".equalsIgnoreCase(status)) {
                if (effectiveExitDate == null) {
                    logger.debug("Validation failed during {}: inactive employee without exit date", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Inactive employees must have an exit date.");
                }
            } else if (effectiveExitDate != null && requiresExitDateValidation) {
                logger.debug("Validation failed during {}: exit date provided for active employee", operation);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Employees with an exit date must be set to inactive.");
            }

            String costCenterId = employee.getCostCenterId();
            if (costCenterId != null && !costCenterId.isBlank()) {
                CostCenterMetadata metadata = costCenterRepository.findMetadata(costCenterId);
                if (metadata == null) {
                    logger.debug("Validation failed during {}: unknown cost center {}", operation, costCenterId);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Assigned cost center does not exist.");
                }

                if (employee.getClientId() == null || employee.getClientId().isBlank()) {
                    logger.debug("Validation failed during {}: employee missing client reference", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Employee must be assigned to a client.");
                }

                if (!metadata.clientId().equals(employee.getClientId())) {
                    logger.debug("Validation failed during {}: employee client mismatch", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Employee and cost center must belong to the same client.");
                }

                if (employee.getManagerId() == null || employee.getManagerId().isBlank()) {
                    logger.debug("Validation failed during {}: employee missing manager", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Employees assigned to a cost center must have a manager.");
                }

                if (!employee.getManagerId().equals(metadata.responsibleId())) {
                    logger.debug("Validation failed during {}: manager {} does not match responsible {}", operation,
                            employee.getManagerId(), metadata.responsibleId());
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                            "Employees assigned to a cost center must use the responsible employee as their manager.");
                }
            }
        }
    }

    public void assignEmployeeIds(List<Map<String, Object>> entries) {
        if (entries == null || entries.isEmpty()) {
            return;
        }

        Map<String, List<Map<String, Object>>> entriesByClient = new LinkedHashMap<>();
        for (Map<String, Object> entry : entries) {
            if (entry == null) {
                continue;
            }

            Object providedId = entry.get("employeeId");
            if (providedId instanceof String provided && !provided.isBlank()) {
                logger.debug("Validation failed during create: employeeId {} was provided explicitly", provided);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Employee ID is generated automatically and must not be provided.");
            }

            String clientId = extractAssociationId(entry, "client");
            if (clientId == null || clientId.isBlank()) {
                logger.debug("Validation failed during create: missing client reference for employee ID generation");
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Employee must reference a client to generate an ID.");
            }

            entriesByClient.computeIfAbsent(clientId, ignored -> new ArrayList<>()).add(entry);
        }

        for (Map.Entry<String, List<Map<String, Object>>> group : entriesByClient.entrySet()) {
            String clientId = group.getKey();
            List<Map<String, Object>> clientEntries = group.getValue();
            EmployeeIdSeed seed = employeeRepository.loadEmployeeIdSeed(clientId, clientEntries.size());
            EmployeeIdSequence sequence = new EmployeeIdSequence(seed.companyId(), seed.nextCounter(),
                    EMPLOYEE_ID_MAX_LENGTH);

            for (Map<String, Object> entry : clientEntries) {
                entry.put("employeeId", sequence.nextId());
            }
        }
    }

    private static final class EmployeeIdSequence {

        private final String companyId;
        private int nextCounter;
        private final int maxLength;

        private EmployeeIdSequence(String companyId, int nextCounter, int maxLength) {
            this.companyId = companyId;
            this.nextCounter = Math.max(nextCounter, 1);
            this.maxLength = maxLength;
        }

        private String nextId() {
            String formatted = String.format(EMPLOYEE_ID_FORMAT, companyId, nextCounter);
            if (formatted.length() > maxLength) {
                throw new ServiceException(ErrorStatuses.BAD_REQUEST, String.format(
                        "Generated employee ID exceeds the maximum length of %d characters. Please shorten the company ID or contact an administrator.",
                        maxLength));
            }
            nextCounter++;
            return formatted;
        }
    }
}

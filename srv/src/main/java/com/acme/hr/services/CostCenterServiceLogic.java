package com.acme.hr.services;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.hr.services.model.CostCenterMetadata;
import com.acme.hr.services.model.EmployeeMetadata;
import com.sap.cds.Struct;
import com.sap.cds.services.ErrorStatuses;
import com.sap.cds.services.ServiceException;
import com.sap.cds.services.cds.CdsUpdateEventContext;

import cds.gen.clientservice.CostCenters;

import static com.acme.hr.util.AssociationUtils.extractEntryId;

/**
 * Cost center related payload handling and validation.
 */
public class CostCenterServiceLogic {

    private static final Logger logger = LoggerFactory.getLogger(CostCenterServiceLogic.class);

    private final CostCenterRepository costCenterRepository;
    private final EmployeeRepository employeeRepository;

    public CostCenterServiceLogic(CostCenterRepository costCenterRepository, EmployeeRepository employeeRepository) {
        this.costCenterRepository = costCenterRepository;
        this.employeeRepository = employeeRepository;
    }

    public List<CostCenters> mapEntries(List<Map<String, Object>> entries) {
        if (entries == null || entries.isEmpty()) {
            return Collections.emptyList();
        }

        List<CostCenters> costCenters = new ArrayList<>(entries.size());
        for (Map<String, Object> entry : entries) {
            costCenters.add(Struct.access(entry).as(CostCenters.class));
        }
        return costCenters;
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

    public void validateCostCenters(List<CostCenters> costCenters, List<Map<String, Object>> rawEntries, String operation) {
        boolean isCreate = "create".equalsIgnoreCase(operation);

        for (int i = 0; i < costCenters.size(); i++) {
            CostCenters costCenter = costCenters.get(i);
            Map<String, Object> raw = (rawEntries != null && i < rawEntries.size())
                    ? rawEntries.get(i)
                    : Collections.emptyMap();

            if (isCreate || raw.containsKey("code")) {
                if (costCenter.getCode() == null || costCenter.getCode().isBlank()) {
                    logger.debug("Validation failed during {}: missing cost center code", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center code must not be empty.");
                }
            }
            if (isCreate || raw.containsKey("name")) {
                if (costCenter.getName() == null || costCenter.getName().isBlank()) {
                    logger.debug("Validation failed during {}: missing cost center name", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center name must not be empty.");
                }
            }

            boolean clientProvided = raw.containsKey("client_ID") || raw.containsKey("clientId");
            if (isCreate || clientProvided) {
                if (costCenter.getClientId() == null || costCenter.getClientId().isBlank()) {
                    logger.debug("Validation failed during {}: missing client for cost center", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center must be assigned to a client.");
                }
            }

            boolean responsibleProvided = raw.containsKey("responsible_ID") || raw.containsKey("responsibleId");
            if (isCreate || responsibleProvided) {
                if (costCenter.getResponsibleId() == null || costCenter.getResponsibleId().isBlank()) {
                    logger.debug("Validation failed during {}: missing responsible for cost center", operation);
                    throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center must define a responsible employee.");
                }
            }

            String effectiveClientId = costCenter.getClientId();
            String effectiveResponsibleId = costCenter.getResponsibleId();

            CostCenterMetadata persistedMetadata = null;
            if (!isCreate && (clientProvided || responsibleProvided)
                    && ((effectiveClientId == null || effectiveClientId.isBlank())
                            || (effectiveResponsibleId == null || effectiveResponsibleId.isBlank()))) {
                String costCenterId = costCenter.getId();
                if (costCenterId == null || costCenterId.isBlank()) {
                    costCenterId = extractEntryId(raw);
                }

                if (costCenterId != null && !costCenterId.isBlank()) {
                    persistedMetadata = costCenterRepository.findMetadata(costCenterId);
                }

                if ((effectiveClientId == null || effectiveClientId.isBlank()) && persistedMetadata != null) {
                    effectiveClientId = persistedMetadata.clientId();
                }
                if ((effectiveResponsibleId == null || effectiveResponsibleId.isBlank()) && persistedMetadata != null) {
                    effectiveResponsibleId = persistedMetadata.responsibleId();
                }
            }

            if (!isCreate && clientProvided && (effectiveResponsibleId == null || effectiveResponsibleId.isBlank())) {
                logger.debug("Validation failed during {}: unable to validate responsible for client change", operation);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Responsible employee must be provided or already assigned when changing client.");
            }

            if (effectiveResponsibleId == null || effectiveResponsibleId.isBlank()) {
                continue;
            }

            if (effectiveClientId == null || effectiveClientId.isBlank()) {
                logger.debug("Validation failed during {}: missing client for cost center when responsible is provided", operation);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST, "Cost center must be assigned to a client.");
            }

            EmployeeMetadata responsibleMetadata = employeeRepository.requireEmployeeMetadata(effectiveResponsibleId);
            if (!effectiveClientId.equals(responsibleMetadata.clientId())) {
                logger.debug("Validation failed during {}: responsible employee belongs to another client", operation);
                throw new ServiceException(ErrorStatuses.BAD_REQUEST,
                        "Responsible employee must belong to the same client as the cost center.");
            }
        }
    }
}

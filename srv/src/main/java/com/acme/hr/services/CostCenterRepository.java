package com.acme.hr.services;

import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.acme.hr.services.model.CostCenterMetadata;
import com.sap.cds.Result;
import com.sap.cds.Row;
import com.sap.cds.ql.Select;
import com.sap.cds.ql.cqn.CqnSelect;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.clientservice.CostCenters_;

/**
 * Repository for accessing cost center metadata.
 */
public class CostCenterRepository {

    private static final Logger logger = LoggerFactory.getLogger(CostCenterRepository.class);

    private final PersistenceService persistenceService;

    public CostCenterRepository(PersistenceService persistenceService) {
        this.persistenceService = persistenceService;
    }

    public CostCenterMetadata findMetadata(String costCenterId) {
        if (costCenterId == null || costCenterId.isBlank()) {
            return null;
        }

        CqnSelect select = Select.from(CostCenters_.class)
                .columns(c -> c.ID(), c -> c.client_ID(), c -> c.responsible_ID())
                .byId(costCenterId);
        Result result = persistenceService.run(select);

        Optional<Row> row = result.first();
        if (row.isEmpty()) {
            logger.debug("Cost center {} not found", costCenterId);
            return null;
        }

        String clientId = row.map(r -> r.get(CostCenters_.CLIENT_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);
        String responsibleId = row.map(r -> r.get(CostCenters_.RESPONSIBLE_ID)).filter(String.class::isInstance)
                .map(String.class::cast).orElse(null);

        if (clientId == null || responsibleId == null) {
            logger.debug("Cost center {} missing client or responsible information", costCenterId);
            return null;
        }

        return new CostCenterMetadata(costCenterId, clientId, responsibleId);
    }
}

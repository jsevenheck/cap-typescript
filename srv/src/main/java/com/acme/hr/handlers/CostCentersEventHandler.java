package com.acme.hr.handlers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.acme.hr.handlers.support.ServiceHandlerDependencies;
import com.acme.hr.services.CostCenterServiceLogic;
import com.sap.cds.Result;
import com.sap.cds.services.cds.CdsCreateEventContext;
import com.sap.cds.services.cds.CdsDeleteEventContext;
import com.sap.cds.services.cds.CdsReadEventContext;
import com.sap.cds.services.cds.CdsUpdateEventContext;
import com.sap.cds.services.handler.EventHandler;
import com.sap.cds.services.handler.annotations.On;
import com.sap.cds.services.handler.annotations.ServiceName;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.clientservice.ClientService_;
import cds.gen.clientservice.CostCenters;
import cds.gen.clientservice.CostCenters_;

/**
 * Handles cost center CRUD events and delegates to CAP persistence after validation.
 */
@Component
@ServiceName(ClientService_.CDS_NAME)
public class CostCentersEventHandler implements EventHandler {

    private static final Logger logger = LoggerFactory.getLogger(CostCentersEventHandler.class);

    private final PersistenceService persistenceService;
    private final CostCenterServiceLogic costCenterLogic;

    public CostCentersEventHandler(ServiceHandlerDependencies dependencies) {
        this.persistenceService = dependencies.getPersistenceService();
        this.costCenterLogic = dependencies.getCostCenterLogic();
    }

    @On(event = "READ", entity = CostCenters_.CDS_NAME)
    public void onRead(CdsReadEventContext context) {
        logger.debug("Reading cost centers with query: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "CREATE", entity = CostCenters_.CDS_NAME)
    public void onCreate(CdsCreateEventContext context) {
        List<Map<String, Object>> entries = context.getCqn().entries();
        if (entries == null) {
            entries = new ArrayList<>();
        }

        List<CostCenters> costCenters = costCenterLogic.mapEntries(entries);
        costCenterLogic.validateCostCenters(costCenters, entries, "create");

        logger.debug("Creating {} cost center(s)", costCenters.size());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "UPDATE", entity = CostCenters_.CDS_NAME)
    public void onUpdate(CdsUpdateEventContext context) {
        List<Map<String, Object>> entries = costCenterLogic.collectUpdateEntries(context);
        List<CostCenters> costCenters = costCenterLogic.mapEntries(entries);
        costCenterLogic.validateCostCenters(costCenters, entries, "update");

        logger.debug("Updating cost centers with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "DELETE", entity = CostCenters_.CDS_NAME)
    public void onDelete(CdsDeleteEventContext context) {
        logger.debug("Deleting cost centers with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }
}

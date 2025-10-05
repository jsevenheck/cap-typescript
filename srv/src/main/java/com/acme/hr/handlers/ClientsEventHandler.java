package com.acme.hr.handlers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.acme.hr.handlers.support.ServiceHandlerDependencies;
import com.acme.hr.services.ClientServiceLogic;
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
import cds.gen.clientservice.Clients;
import cds.gen.clientservice.Clients_;

/**
 * Handles client CRUD events and delegates to CAP persistence after validation.
 */
@Component
@ServiceName(ClientService_.CDS_NAME)
public class ClientsEventHandler implements EventHandler {

    private static final Logger logger = LoggerFactory.getLogger(ClientsEventHandler.class);

    private final PersistenceService persistenceService;
    private final ClientServiceLogic clientLogic;

    public ClientsEventHandler(ServiceHandlerDependencies dependencies) {
        this.persistenceService = dependencies.getPersistenceService();
        this.clientLogic = dependencies.getClientLogic();
    }

    @On(event = "READ", entity = Clients_.CDS_NAME)
    public void onRead(CdsReadEventContext context) {
        logger.debug("Reading clients with query: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "CREATE", entity = Clients_.CDS_NAME)
    public void onCreate(CdsCreateEventContext context) {
        List<Map<String, Object>> entries = context.getCqn().entries();
        if (entries == null) {
            entries = new ArrayList<>();
        }

        List<Clients> clients = clientLogic.mapEntries(entries);
        clientLogic.validateClients(clients, entries, "create");

        logger.debug("Creating {} client(s)", clients.size());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "UPDATE", entity = Clients_.CDS_NAME)
    public void onUpdate(CdsUpdateEventContext context) {
        List<Map<String, Object>> entries = clientLogic.collectUpdateEntries(context);
        List<Clients> clients = clientLogic.mapEntries(entries);
        clientLogic.validateClients(clients, entries, "update");

        logger.debug("Updating clients with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "DELETE", entity = Clients_.CDS_NAME)
    public void onDelete(CdsDeleteEventContext context) {
        logger.debug("Deleting clients with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }
}

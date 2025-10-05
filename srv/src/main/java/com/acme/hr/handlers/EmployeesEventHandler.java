package com.acme.hr.handlers;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.acme.hr.handlers.support.ServiceHandlerDependencies;
import com.acme.hr.services.EmployeeServiceLogic;
import com.acme.hr.services.EmployeeThirdPartyNotifier;
import com.acme.hr.services.EmployeeThirdPartyNotifier.PreparedNotification;
import com.sap.cds.Result;
import com.sap.cds.Row;
import com.sap.cds.services.cds.CdsCreateEventContext;
import com.sap.cds.services.cds.CdsDeleteEventContext;
import com.sap.cds.services.cds.CdsReadEventContext;
import com.sap.cds.services.cds.CdsUpdateEventContext;
import com.sap.cds.services.changeset.ChangeSetContext;
import com.sap.cds.services.changeset.ChangeSetListener;
import com.sap.cds.services.handler.EventHandler;
import com.sap.cds.services.handler.annotations.On;
import com.sap.cds.services.handler.annotations.ServiceName;
import com.sap.cds.services.persistence.PersistenceService;

import cds.gen.clientservice.ClientService_;
import cds.gen.clientservice.Employees;
import cds.gen.clientservice.Employees_;

/**
 * Handles employee CRUD events and optional third-party notifications.
 */
@Component
@ServiceName(ClientService_.CDS_NAME)
public class EmployeesEventHandler implements EventHandler {

    private static final Logger logger = LoggerFactory.getLogger(EmployeesEventHandler.class);

    private final PersistenceService persistenceService;
    private final EmployeeServiceLogic employeeLogic;
    private final EmployeeThirdPartyNotifier employeeNotifier;

    public EmployeesEventHandler(ServiceHandlerDependencies dependencies) {
        this.persistenceService = dependencies.getPersistenceService();
        this.employeeLogic = dependencies.getEmployeeLogic();
        this.employeeNotifier = dependencies.getEmployeeNotifier();
    }

    @On(event = "READ", entity = Employees_.CDS_NAME)
    public void onRead(CdsReadEventContext context) {
        logger.debug("Reading employees with query: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "CREATE", entity = Employees_.CDS_NAME)
    public void onCreate(CdsCreateEventContext context) {
        List<Map<String, Object>> entries = context.getCqn().entries();
        if (entries == null) {
            entries = new ArrayList<>();
        }

        employeeLogic.applyCostCenterRules(entries, "create");
        employeeLogic.assignEmployeeIds(entries);
        List<Employees> employees = employeeLogic.mapEntries(entries);
        employeeLogic.validateEmployees(employees, entries, "create");

        logger.debug("Creating {} employee(s)", employees.size());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);

        List<Map<String, Object>> notificationEntries = new ArrayList<>(entries.size());
        for (Map<String, Object> entry : entries) {
            Map<String, Object> copy = new LinkedHashMap<>();
            if (entry != null) {
                copy.putAll(entry);
            }
            notificationEntries.add(copy);
        }

        List<Row> persistedRows = new ArrayList<>(result.list());
        PreparedNotification preparedNotification = employeeNotifier.prepareEmployeesCreated(notificationEntries, persistedRows);

        if (preparedNotification.isEmpty()) {
            return;
        }

        ChangeSetContext changeSet = context.getChangeSetContext();
        if (changeSet != null) {
            changeSet.register(new ChangeSetListener() {
                @Override
                public void afterClose(boolean succeeded) {
                    if (!succeeded) {
                        logger.debug("Skipping third-party notification for employees because the transaction was rolled back.");
                        return;
                    }

                    try {
                        employeeNotifier.sendPreparedNotification(preparedNotification);
                    } catch (RuntimeException ex) {
                        logger.error("Failed to notify third-party service about created employees after commit.", ex);
                    }
                }
            });
        } else {
            employeeNotifier.sendPreparedNotification(preparedNotification);
        }
    }

    @On(event = "UPDATE", entity = Employees_.CDS_NAME)
    public void onUpdate(CdsUpdateEventContext context) {
        List<Map<String, Object>> entries = employeeLogic.collectUpdateEntries(context);
        employeeLogic.applyCostCenterRules(entries, "update");
        List<Employees> employees = employeeLogic.mapEntries(entries);
        employeeLogic.validateEmployees(employees, entries, "update");

        logger.debug("Updating employees with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }

    @On(event = "DELETE", entity = Employees_.CDS_NAME)
    public void onDelete(CdsDeleteEventContext context) {
        logger.debug("Deleting employees with statement: {}", context.getCqn());
        Result result = persistenceService.run(context.getCqn());
        context.setResult(result);
    }
}

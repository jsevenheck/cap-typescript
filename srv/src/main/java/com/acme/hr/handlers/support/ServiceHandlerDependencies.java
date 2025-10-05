package com.acme.hr.handlers.support;

import org.springframework.stereotype.Component;

import com.acme.hr.services.ClientServiceLogic;
import com.acme.hr.services.CostCenterRepository;
import com.acme.hr.services.CostCenterServiceLogic;
import com.acme.hr.services.EmployeeRepository;
import com.acme.hr.services.EmployeeServiceLogic;
import com.acme.hr.services.EmployeeThirdPartyNotifier;
import com.sap.cds.services.persistence.PersistenceService;

/**
 * Centralises the construction of reusable service-layer helpers for CAP event handlers.
 */
@Component
public class ServiceHandlerDependencies {

    private final PersistenceService persistenceService;
    private final ClientServiceLogic clientLogic;
    private final EmployeeServiceLogic employeeLogic;
    private final CostCenterServiceLogic costCenterLogic;
    private final EmployeeThirdPartyNotifier employeeNotifier;

    public ServiceHandlerDependencies(PersistenceService persistenceService,
            EmployeeThirdPartyNotifier employeeNotifier) {
        this.persistenceService = persistenceService;
        this.employeeNotifier = employeeNotifier;

        CostCenterRepository costCenterRepository = new CostCenterRepository(persistenceService);
        EmployeeRepository employeeRepository = new EmployeeRepository(persistenceService, costCenterRepository);
        this.clientLogic = new ClientServiceLogic();
        this.employeeLogic = new EmployeeServiceLogic(costCenterRepository, employeeRepository);
        this.costCenterLogic = new CostCenterServiceLogic(costCenterRepository, employeeRepository);
    }

    public PersistenceService getPersistenceService() {
        return persistenceService;
    }

    public ClientServiceLogic getClientLogic() {
        return clientLogic;
    }

    public EmployeeServiceLogic getEmployeeLogic() {
        return employeeLogic;
    }

    public CostCenterServiceLogic getCostCenterLogic() {
        return costCenterLogic;
    }

    public EmployeeThirdPartyNotifier getEmployeeNotifier() {
        return employeeNotifier;
    }
}

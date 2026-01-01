using { clientmgmt.Clients, clientmgmt.Employees, clientmgmt.CostCenters, clientmgmt.Locations, clientmgmt.EmployeeCostCenterAssignments } from '../db/schema';

// AMS attribute mappings for authorization based on company codes
annotate Clients with @ams.attributes: { CompanyCode: (companyId) };

annotate Employees with @ams.attributes: { CompanyCode: (client.companyId) };

annotate CostCenters with @ams.attributes: { CompanyCode: (client.companyId) };

annotate Locations with @ams.attributes: { CompanyCode: (client.companyId) };

annotate EmployeeCostCenterAssignments with @ams.attributes: { CompanyCode: (client.companyId) };

using { clientmgmt.Employees } from '../db/schema';

annotate Employees with @ams.attributes: { CompanyCode: (client.companyId) };

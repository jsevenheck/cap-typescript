service NotificationService @(path:'/internal/notifications', impl:'./notification-service.ts') {
  event NotifyNewEmployee {
    employeeId      : String;
    employeeUUID    : String;
    clientCompanyId : String(40);
    client_ID       : String;
    firstName       : String(60);
    lastName        : String(60);
    email           : String(120);
  };
}

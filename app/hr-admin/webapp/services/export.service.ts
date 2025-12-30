/**
 * Escapes a value for safe CSV output.
 * Handles special characters by wrapping in quotes and escaping internal quotes.
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);

  // Prevent CSV formula injection by neutralizing leading =, +, - or @
  let safeValue = stringValue;
  if (/^[=+\-@]/.test(safeValue)) {
    safeValue = "'" + safeValue;
  }

  // If the value contains special characters, wrap in quotes
  if (safeValue.includes(",") || safeValue.includes('"') || safeValue.includes("\n") || safeValue.includes("\r")) {
    // Escape quotes by doubling them
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  return safeValue;
}

/**
 * Generates a CSV string from an array of objects.
 * Note: If the data array is empty, returns a CSV with headers only.
 * Callers should check for empty data before calling if that behavior is undesired.
 * @param data - Array of objects to convert to CSV
 * @param columns - Array of column configurations with field name and header
 * @returns CSV string with BOM for Excel compatibility
 */
export function generateCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { field: keyof T; header: string }[]
): string {
  // Create header row
  const headerRow = columns.map(col => escapeCSVValue(col.header)).join(",");
  
  // Create data rows
  const dataRows = data.map(item =>
    columns.map(col => escapeCSVValue(item[col.field])).join(",")
  );
  
  // Add BOM (Byte Order Mark) for proper Excel UTF-8 handling
  const BOM = "\uFEFF";
  
  return BOM + headerRow + "\n" + dataRows.join("\n");
}

/**
 * Downloads a string as a file.
 * @param content - The file content
 * @param filename - The name of the file
 * @param mimeType - The MIME type of the file
 */
export function downloadFile(content: string, filename: string, mimeType: string = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Employee data structure for CSV export
 */
export interface EmployeeExportData {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  positionLevel?: string;
  entryDate: string;
  exitDate?: string;
  status: string;
  employmentType: string;
}

/**
 * Exports employees to CSV and triggers download.
 * @param employees - Array of employee data to export
 * @param clientName - Name of the client for the filename
 * @param i18nBundle - Optional i18n bundle providing localized column headers
 */
export function exportEmployeesToCSV(
  employees: EmployeeExportData[],
  clientName?: string,
  i18nBundle?: { getText(key: string): string }
): void {
  const columns: { field: keyof EmployeeExportData; header: string }[] = [
    { field: "employeeId", header: i18nBundle?.getText("employeeId") || "Employee ID" },
    { field: "firstName", header: i18nBundle?.getText("firstName") || "First Name" },
    { field: "lastName", header: i18nBundle?.getText("lastName") || "Last Name" },
    { field: "email", header: i18nBundle?.getText("email") || "Email" },
    { field: "phoneNumber", header: i18nBundle?.getText("phoneNumber") || "Phone Number" },
    { field: "positionLevel", header: i18nBundle?.getText("positionLevel") || "Position Level" },
    { field: "entryDate", header: i18nBundle?.getText("entryDate") || "Entry Date" },
    { field: "exitDate", header: i18nBundle?.getText("exitDate") || "Exit Date" },
    { field: "status", header: i18nBundle?.getText("status") || "Status" },
    { field: "employmentType", header: i18nBundle?.getText("employmentType") || "Employment Type" },
  ];
  
  const csvContent = generateCSV(employees, columns);
  
  const MAX_CLIENT_NAME_LENGTH = 50;
  const sanitizedClientName = clientName 
    ? clientName
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")  // Collapse consecutive underscores
        .replace(/^_|_$/g, "") // Remove leading/trailing underscores
        .substring(0, MAX_CLIENT_NAME_LENGTH) || "employees"
    : "employees";
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizedClientName}_employees_${timestamp}.csv`;
  
  downloadFile(csvContent, filename);
}

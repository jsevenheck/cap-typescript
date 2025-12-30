/**
 * Escapes a value for safe CSV output.
 * Handles special characters by wrapping in quotes and escaping internal quotes.
 */
function escapeCSVValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  
  const stringValue = String(value);
  
  // If the value contains special characters, wrap in quotes
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n") || stringValue.includes("\r")) {
    // Escape quotes by doubling them
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  
  return stringValue;
}

/**
 * Generates a CSV string from an array of objects.
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
 */
export function exportEmployeesToCSV(employees: EmployeeExportData[], clientName?: string): void {
  const columns: { field: keyof EmployeeExportData; header: string }[] = [
    { field: "employeeId", header: "Employee ID" },
    { field: "firstName", header: "First Name" },
    { field: "lastName", header: "Last Name" },
    { field: "email", header: "Email" },
    { field: "phoneNumber", header: "Phone Number" },
    { field: "positionLevel", header: "Position Level" },
    { field: "entryDate", header: "Entry Date" },
    { field: "exitDate", header: "Exit Date" },
    { field: "status", header: "Status" },
    { field: "employmentType", header: "Employment Type" },
  ];
  
  const csvContent = generateCSV(employees, columns);
  
  const MAX_CLIENT_NAME_LENGTH = 50;
  const sanitizedClientName = clientName 
    ? clientName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, MAX_CLIENT_NAME_LENGTH) 
    : "employees";
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizedClientName}_employees_${timestamp}.csv`;
  
  downloadFile(csvContent, filename);
}

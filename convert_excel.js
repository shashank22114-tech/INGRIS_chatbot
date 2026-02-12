import xlsx from "xlsx";
import fs from "fs";
import path from "path";

// Path to your Excel file inside data folder
const excelPath = path.join("data", "water_data1.xlsx");

// Read the Excel workbook
const workbook = xlsx.readFile(excelPath);

// Take the first sheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert sheet → JSON
const jsonData = xlsx.utils.sheet_to_json(worksheet);

// Save JSON into /data folder
const outputPath = path.join("data", "groundwater.json");
fs.writeFileSync(outputPath, JSON.stringify(jsonData, null, 2));

console.log("✅ Excel converted to groundwater.json successfully!");

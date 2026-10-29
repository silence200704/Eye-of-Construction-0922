export interface InsightCount { id: string; label: string; count: number; }
export interface InsightDay { date: string; count: number; }
export interface InsightQuery { period: string; buildingId: string; }
export interface MobileInsights {
  period: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  source: string;
  totalEvents: number;
  openEvents: number;
  recordCount: number;
  trend: InsightDay[];
  byBuilding: InsightCount[];
  byPoint: InsightCount[];
  sensorTypes: InsightCount[];
}

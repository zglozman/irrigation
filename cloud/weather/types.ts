// Weather provider interfaces

export interface HourlyForecast {
  time: string; // ISO timestamp
  tempF: number;
  windMph: number;
  precipProb: number; // 0-1
  precipIn: number;
}

export interface ForecastProvider {
  getForecast(lat: number, lon: number): Promise<HourlyForecast[]>;
}

export interface RainfallProvider {
  getRainfallSince(sinceIso: string, lat: number, lon: number): Promise<number>; // inches
}

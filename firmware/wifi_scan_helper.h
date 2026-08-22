// Direct ESP-IDF WiFi scanning, independent of ESPHome's wifi component.
//
// The ESPHome wifi component's connect state machine cannot sit idle without
// credentials (it cycles retry phases, aborting scans and flapping the MQTT
// session), so provisioning scans bypass it entirely: bring the driver up in
// STA mode, scan, collect, and stop the driver again. The component itself
// stays disabled until credentials are saved.
#pragma once

#ifdef USE_ESP_IDF
#include <esp_err.h>
#include <esp_wifi.h>
#include <algorithm>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace wifiprov {

inline bool &driver_started() {
  static bool started = false;
  return started;
}

// Bring the driver up (idempotent) and kick a non-blocking active scan.
inline bool start_scan() {
  if (!driver_started()) {
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_err_t err = esp_wifi_init(&cfg);
    // Already-initialized is fine; anything else is fatal for the scan.
    if (err != ESP_OK && err != ESP_ERR_WIFI_INIT_STATE) {
      return false;
    }
    esp_wifi_set_mode(WIFI_MODE_STA);
    err = esp_wifi_start();
    if (err != ESP_OK && err != ESP_ERR_WIFI_STATE) {
      return false;
    }
    driver_started() = true;
  }
  wifi_scan_config_t sc = {};
  sc.show_hidden = false;
  sc.scan_type = WIFI_SCAN_TYPE_ACTIVE;
  sc.scan_time.active.min = 100;
  sc.scan_time.active.max = 300;
  return esp_wifi_scan_start(&sc, false) == ESP_OK;
}

inline int result_count() {
  uint16_t n = 0;
  if (esp_wifi_scan_get_ap_num(&n) != ESP_OK) return 0;
  return n;
}

// Drain scan results into the JSON shape the cloud expects:
// [{"ssid":"...","rssi":-52,"secured":true}, ...] strongest-first, capped.
inline std::string collect_json() {
  uint16_t n = 0;
  esp_wifi_scan_get_ap_num(&n);
  if (n == 0) return "[]";
  std::vector<wifi_ap_record_t> recs(n);
  if (esp_wifi_scan_get_ap_records(&n, recs.data()) != ESP_OK) return "[]";

  std::map<std::string, std::pair<int, bool>> best;  // ssid -> (rssi, secured)
  for (uint16_t i = 0; i < n; i++) {
    std::string ssid(reinterpret_cast<const char *>(recs[i].ssid));
    if (ssid.empty()) continue;
    bool secured = recs[i].authmode != WIFI_AUTH_OPEN;
    auto it = best.find(ssid);
    if (it == best.end() || recs[i].rssi > it->second.first) {
      best[ssid] = {recs[i].rssi, secured};
    }
  }

  std::vector<std::pair<std::string, std::pair<int, bool>>> nets(best.begin(), best.end());
  std::sort(nets.begin(), nets.end(),
            [](const auto &a, const auto &b) { return a.second.first > b.second.first; });
  if (nets.size() > 15) nets.resize(15);

  std::string json = "[";
  bool first = true;
  for (const auto &np : nets) {
    std::string esc;
    for (char c : np.first) {
      if (c == '"' || c == '\\') esc += '\\';
      esc += c;
    }
    char rssi_buf[16];
    snprintf(rssi_buf, sizeof(rssi_buf), "%d", np.second.first);
    if (!first) json += ",";
    first = false;
    json += "{\"ssid\":\"" + esc + "\",\"rssi\":" + rssi_buf +
            ",\"secured\":" + (np.second.second ? "true" : "false") + "}";
  }
  json += "]";
  return json;
}

// Stop the driver again — call only while the ESPHome wifi component is
// disabled, so a provisioned/enabled component is never yanked down.
inline void stop() {
  if (driver_started()) {
    esp_wifi_stop();
    driver_started() = false;
  }
}

}  // namespace wifiprov
#endif  // USE_ESP_IDF

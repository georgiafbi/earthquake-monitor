# 📱 Android Cross-Platform Earthquake Monitor Improvement Specification

**Document Version**: `1.0.0`  
**Originating Web App**: `earthquake-monitor` (formerly `leaflet-challenge`, `origin master`)  
**Target Android App**: `earthquake-android` (`origin main`)  
**Specification Date**: September 14, 2026  

---

## 1. Executive Summary
This specification documents the features, data structures, and user experience enhancements autonomously developed in the **Web-based Earthquake Monitor** (`earthquake-monitor`) for adoption and parity in the native **Android Earthquake Monitor** (`earthquake-android`).

Key additions include:
1. **USGS PAGER Emergency Impact Badges** (green, yellow, orange, red loss/casualty alerts).
2. **Modified Mercalli Intensity (MMI / CDI)** scale conversion to Roman numerals with descriptive shaking intensity.
3. **Citizen Science "Did You Feel It?" (DYFI)** felt report aggregation.
4. **Significance Metric** index preservation (0–1000).
5. **Data Export & Sharing** capabilities (CSV & GeoJSON).
6. **Human-Induced vs. Natural Origin Classification** (quarry blasts, mining explosions, rock bursts, detonations) with dedicated filtering and badges.

---

## 2. USGS GeoJSON Feed Schema Extensions

The USGS GeoJSON payload includes properties under `feature.properties` that provide vital post-event impact information:

| Property | Type | Description | Web Implementation |
| :--- | :--- | :--- | :--- |
| `type` | `String` | Event type identifier (`"earthquake"`, `"quarry blast"`, `"mining explosion"`, `"rock burst"`, `"explosion"`). | Classified into `isInduced: Boolean` and `eventOrigin: "natural" | "induced"`. |
| `alert` | `String?` | PAGER alert level (`"green"`, `"yellow"`, `"orange"`, `"red"`). | Normalized, validated, colored popup badge & feed tag. |
| `felt` | `Int?` | Count of citizen Did You Feel It? (DYFI) responses. | Displayed in popup and feed cards with `👥 {n} felt`. |
| `mmi` | `Double?` | Instrumental Modified Mercalli Intensity. | Formatted as Roman numeral I–X+ with human-readable shaking description. |
| `cdi` | `Double?` | Community Decimal Intensity (citizen-reported). | Fallback when instrumental `mmi` is null. |
| `sig` | `Int?` | USGS Significance score (0–1000). | Evaluated for event sorting and impact priority. |

---

## 3. Kotlin Architecture & Domain Modeling

### A. DTO Extensions (`com.earthquake.monitor.model.Earthquake.kt`)
Update `EarthquakePropertiesDto` to deserialize the new USGS fields with optional defaults:

```kotlin
@Serializable
data class EarthquakePropertiesDto(
    val mag: Double? = null,
    val place: String? = null,
    val time: Long? = null,
    val updated: Long? = null,
    val url: String? = null,
    val detail: String? = null,
    val status: String? = null,
    val tsunami: Int? = null,
    val sig: Int? = null,
    val type: String? = "earthquake",
    val title: String? = null,
    
    // New Cross-Platform USGS Impact Properties:
    val alert: String? = null,
    val felt: Int? = null,
    val cdi: Double? = null,
    val mmi: Double? = null
)
```

### B. Domain Model Extensions
Update `Earthquake` to hold parsed impact models:

```kotlin
enum class PagerLevel(val label: String, val description: String) {
    GREEN("GREEN", "Low risk of fatalities and economic losses"),
    YELLOW("YELLOW", "Local casualties or economic damage possible"),
    ORANGE("ORANGE", "Significant casualties and damage likely"),
    RED("RED", "Extensive casualties and widespread disaster")
}

data class MercalliIntensity(
    val value: Double,
    val roman: String,
    val shaking: String,
    val label: String
)

data class Earthquake(
    val id: String,
    val magnitude: Double?,
    val magnitudeFormatted: String,
    val place: String,
    val timestamp: Long,
    val longitude: Double,
    val latitude: Double,
    val depth: Double,
    val depthRange: DepthRange,
    val detailUrl: String?,
    val usgsUrl: String?,
    val eventType: String,
    val displayRegion: String,
    val championGroup: String,
    val state: String? = null,
    val stateCode: String? = null,
    val country: String? = null,
    val countryCode: String? = null,
    val searchIndex: String = "",
    val isChampion: Boolean = false,
    val isSelected: Boolean = false,
    val namedFaults: List<String> = emptyList(),
    val tectonicPlates: List<String> = emptyList(),
    val tectonicContext: String? = null,
    val tsunami: Int = 0,
    val energyJoules: Double = calculateSeismicEnergyJoules(magnitude),
    
    // Cross-Platform Additions:
    val alert: String? = null,
    val felt: Int = 0,
    val mmi: Double? = null,
    val sig: Int = 0
) {
    val pagerLevel: PagerLevel?
        get() = when (alert?.trim()?.lowercase()) {
            "green" -> PagerLevel.GREEN
            "yellow" -> PagerLevel.YELLOW
            "orange" -> PagerLevel.ORANGE
            "red" -> PagerLevel.RED
            else -> null
        }

    val mercalliIntensity: MercalliIntensity?
        get() = formatMercalliIntensity(mmi)
}

fun formatMercalliIntensity(mmi: Double?): MercalliIntensity? {
    if (mmi == null || !mmi.isFinite() || mmi < 1.0) return null
    val valRound = Math.round(mmi).toInt().coerceIn(1, 10)
    val roman = listOf("", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X+")[valRound]
    val desc = when {
        mmi < 2.0 -> "Micro (Felt by few)"
        mmi < 3.0 -> "Weak (Felt indoors)"
        mmi < 4.0 -> "Noticeable (Like passing heavy truck)"
        mmi < 5.0 -> "Light (Dishes rattle, cars rock)"
        mmi < 6.0 -> "Moderate (Felt by all, slight damage)"
        mmi < 7.0 -> "Strong (Furniture moved, plaster cracks)"
        mmi < 8.0 -> "Very Strong (Considerable masonry damage)"
        mmi < 9.0 -> "Severe (Major structural damage, walls collapse)"
        mmi < 10.0 -> "Violent (Buildings collapsed, ground cracks)"
        else -> "Extreme (Total destruction)"
    }
    return MercalliIntensity(
        value = Math.round(mmi * 10.0) / 10.0,
        roman = roman,
        shaking = desc,
        label = "MMI $roman ($desc)"
    )
}
```

---

## 4. Jetpack Compose UI Integration

### A. List Cards (`EarthquakeCard.kt`)
- Render a compact pill badge if `earthquake.pagerLevel != null`:
  - `GREEN`: Container `Color(0xFF14532D)`, Text `Color(0xFF86EFAC)`
  - `YELLOW`: Container `Color(0xFF713F12)`, Text `Color(0xFFFDE047)`
  - `ORANGE`: Container `Color(0xFF7C2D12)`, Text `Color(0xFFFDBA74)`
  - `RED`: Container `Color(0xFF7F1D1D)`, Text `Color(0xFFFCA5A5)`
- Render felt reports pill if `earthquake.felt > 0`: `👥 ${earthquake.felt} felt`.

### B. Bottom Sheet Details (`EarthquakeDetailSheet.kt`)
Add an **Emergency Impact & Severity** row above scientific fault context:
1. **PAGER Level**: Displays title, colored badge, and risk description.
2. **Mercalli Intensity**: Displays Roman numeral and perceived shaking level.
3. **DYFI Reports**: Shows citizen observation count.

### C. Native Sharing / Export (`EarthquakeViewModel.kt`)
Add Android Intent-based sharing for filtered datasets:
- Generates a cached CSV or GeoJSON file in `context.cacheDir`.
- Launches standard Android `Intent(Intent.ACTION_SEND)` sharing sheet to allow saving to Google Drive, email, or local files.

---

## 5. Verification & Testing Matrix

| Component | Web (Leaflet) Automated Test | Android Unit Test Equivalent |
| :--- | :--- | :--- |
| **PAGER Alert Normalization** | `normalizes and formats PAGER emergency alert levels` | `EarthquakeLogicTest.testPagerAlertNormalization()` |
| **MMI Calculation** | `formats Mercalli intensity with Roman numerals...` | `EarthquakeLogicTest.testMercalliIntensityCalculation()` |
| **Feature Normalization** | `normalizes earthquake features with alert, felt...` | `EarthquakeLogicTest.testFeatureDeserializationWithImpact()` |
| **Data Export** | `exports active earthquake features to valid CSV...` | `EarthquakeLogicTest.testCsvExportGeneration()` |

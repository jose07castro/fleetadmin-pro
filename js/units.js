/* ============================================
   FleetAdmin Pro — Sistema de Conversión de Unidades
   KM ↔ Millas, Litros ↔ Galones
   ============================================ */

const Units = (() => {
    // Factores de conversión
    const KM_TO_MI = 0.621371;
    const MI_TO_KM = 1.60934;
    const L_TO_GAL = 0.264172;
    const GAL_TO_L = 3.78541;

    // Intervalo de correa de distribución
    const BELT_INTERVAL_KM = 60000;
    const BELT_WARNING_KM = 5000;

    // Obtener unidad actual de distancia
    function getDistanceUnit() {
        return localStorage.getItem('fleetadmin_distance_unit') || 'km';
    }

    function setDistanceUnit(unit) {
        localStorage.setItem('fleetadmin_distance_unit', unit);
    }

    // Obtener unidad actual de volumen
    function getVolumeUnit() {
        return localStorage.getItem('fleetadmin_volume_unit') || 'l';
    }

    function setVolumeUnit(unit) {
        localStorage.setItem('fleetadmin_volume_unit', unit);
    }

    // --- Conversiones de distancia ---
    function kmToMi(km) {
        return km * KM_TO_MI;
    }

    function miToKm(mi) {
        return mi * MI_TO_KM;
    }

    // Convertir a la unidad preferida del usuario (los datos siempre se guardan en KM)
    function displayDistance(km) {
        const unit = getDistanceUnit();
        if (unit === 'mi') {
            return kmToMi(km);
        }
        return km;
    }

    // Convertir de la unidad del usuario a KM (para guardar)
    function toKm(value) {
        const unit = getDistanceUnit();
        if (unit === 'mi') {
            return miToKm(value);
        }
        return value;
    }

    // Formatear distancia con unidad
    function formatDistance(km, decimals = 0) {
        const unit = getDistanceUnit();
        const value = displayDistance(km);
        const label = unit === 'mi' ? I18n.t('unit_mi_short') : I18n.t('unit_km_short');
        return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals })} ${label}`;
    }

    // --- Conversiones de volumen ---
    function lToGal(l) {
        return l * L_TO_GAL;
    }

    function galToL(gal) {
        return gal * GAL_TO_L;
    }

    // Convertir a la unidad preferida (los datos siempre se guardan en Litros)
    function displayVolume(liters) {
        const unit = getVolumeUnit();
        if (unit === 'gal') {
            return lToGal(liters);
        }
        return liters;
    }

    // Convertir de la unidad del usuario a Litros (para guardar)
    function toLiters(value) {
        const unit = getVolumeUnit();
        if (unit === 'gal') {
            return galToL(value);
        }
        return value;
    }

    // Formatear volumen con unidad
    function formatVolume(liters, decimals = 1) {
        const unit = getVolumeUnit();
        const value = displayVolume(liters);
        const label = unit === 'gal' ? I18n.t('unit_gal_short') : I18n.t('unit_l_short');
        return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals })} ${label}`;
    }

    // --- Etiquetas de unidad ---
    function distanceLabel() {
        return getDistanceUnit() === 'mi' ? I18n.t('unit_mi_short') : I18n.t('unit_km_short');
    }

    function volumeLabel() {
        return getVolumeUnit() === 'gal' ? I18n.t('unit_gal_short') : I18n.t('unit_l_short');
    }

    // --- Intervalo de correa ajustado a la unidad actual ---
    function getBeltInterval() {
        return displayDistance(BELT_INTERVAL_KM);
    }

    function getBeltWarning() {
        return displayDistance(BELT_WARNING_KM);
    }

    // Intervalo siempre en KM para la lógica interna
    function getBeltIntervalKm() {
        return BELT_INTERVAL_KM;
    }

    function getBeltWarningKm() {
        return BELT_WARNING_KM;
    }

    return {
        getDistanceUnit, setDistanceUnit,
        getVolumeUnit, setVolumeUnit,
        kmToMi, miToKm,
        displayDistance, toKm, formatDistance,
        lToGal, galToL,
        displayVolume, toLiters, formatVolume,
        distanceLabel, volumeLabel,
        getBeltInterval, getBeltWarning,
        getBeltIntervalKm, getBeltWarningKm
    };
})();

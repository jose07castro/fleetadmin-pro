/* ============================================
   FleetAdmin Pro — Firebase Storage Utility
   Subida de imágenes a Firebase Storage
   con compresión automática en el cliente
   ============================================ */

const StorageUtil = (() => {

    const MAX_DIMENSION = 1920; // Máximo ancho/alto en px
    const JPEG_QUALITY = 0.7;  // Calidad JPEG (0.0 - 1.0)

    /**
     * Comprime una imagen (data URL) redimensionándola y bajando calidad JPEG.
     * @param {string} dataUrl - Data URL original (data:image/...).
     * @returns {Promise<Blob>} Blob comprimido listo para subir.
     */
    function compressImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                // Redimensionar si excede MAX_DIMENSION
                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) {
                        height = Math.round(height * (MAX_DIMENSION / width));
                        width = MAX_DIMENSION;
                    } else {
                        width = Math.round(width * (MAX_DIMENSION / height));
                        height = MAX_DIMENSION;
                    }
                }

                // Dibujar en canvas para comprimir
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Exportar como JPEG comprimido
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            const originalKB = Math.round(dataUrl.length * 0.75 / 1024);
                            const compressedKB = Math.round(blob.size / 1024);
                            console.log(`🗜️ Compresión: ${originalKB}KB → ${compressedKB}KB (${width}x${height})`);
                            resolve(blob);
                        } else {
                            reject(new Error('Error al comprimir imagen'));
                        }
                    },
                    'image/jpeg',
                    JPEG_QUALITY
                );
            };
            img.onerror = () => reject(new Error('Error al cargar imagen para compresión'));
            img.src = dataUrl;
        });
    }

    /**
     * Sube una imagen (base64 data URL) a Firebase Storage.
     * Comprime automáticamente antes de subir.
     * @param {string} dataUrl - Data URL (data:image/...).
     * @param {string} path - Ruta en Storage (ej: 'licencias/userId_front.jpg').
     * @returns {Promise<string>} URL pública de descarga.
     */
    async function uploadImage(dataUrl, path) {
        if (!dataUrl || !dataUrl.startsWith('data:')) {
            throw new Error('Dato de imagen inválido');
        }

        // Comprimir imagen antes de subir
        const blob = await compressImage(dataUrl);
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        console.log(`📦 Tamaño final: ${sizeMB}MB`);

        const storageRef = firebaseStorage.ref(path);

        // Subir a Firebase Storage
        const snapshot = await storageRef.put(blob, {
            contentType: 'image/jpeg'
        });

        // Obtener URL pública
        const downloadURL = await snapshot.ref.getDownloadURL();
        return downloadURL;
    }

    /**
     * Sube foto de licencia (frente o dorso) con feedback visual.
     * @param {string} dataUrl - Data URL de la imagen.
     * @param {string} userId - ID del conductor.
     * @param {string} side - 'front' o 'back'.
     * @returns {Promise<string>} URL pública de descarga.
     */
    async function uploadLicensePhoto(dataUrl, userId, side) {
        const fleetId = Auth.getFleetId() || 'default';
        const timestamp = Date.now();
        const path = `licencias/${fleetId}/${userId}_${side}_${timestamp}.jpg`;
        return await uploadImage(dataUrl, path);
    }

    /**
     * Procesa y sube las fotos de licencia, mostrando feedback.
     * @param {object} user - Objeto del usuario a actualizar.
     * @param {string|null} frontData - Data URL de frente (null = no cambiar).
     * @param {string|null} backData - Data URL de dorso (null = no cambiar).
     * @returns {Promise<object>} user actualizado con URLs de Storage.
     */
    async function processLicensePhotos(user, frontData, backData) {
        let uploadCount = 0;
        const total = (frontData ? 1 : 0) + (backData ? 1 : 0);

        if (total === 0) return user;

        // Mostrar indicador de carga
        Components.showToast(`📤 Comprimiendo y subiendo fotos...`, 'info');

        try {
            if (frontData) {
                uploadCount++;
                Components.showToast(`📤 Subiendo foto frente (${uploadCount}/${total})... Por favor espere`, 'info');
                const frontURL = await uploadLicensePhoto(frontData, user.id, 'front');
                user.licenseFrontPhoto = frontURL;
                console.log('✅ Frente subida:', frontURL);
            }

            if (backData) {
                uploadCount++;
                Components.showToast(`📤 Subiendo foto dorso (${uploadCount}/${total})... Por favor espere`, 'info');
                const backURL = await uploadLicensePhoto(backData, user.id, 'back');
                user.licenseBackPhoto = backURL;
                console.log('✅ Dorso subida:', backURL);
            }

            Components.showToast(`✅ ${total} foto(s) subida(s) correctamente`, 'success');
        } catch (error) {
            console.error('❌ Error subiendo foto a Storage:', error);
            Components.showToast(`❌ Error subiendo foto: ${error.message || 'Error desconocido'}. Verificá tu conexión y las reglas de Storage.`, 'danger');
            throw error;
        }

        return user;
    }

    return { compressImage, uploadImage, uploadLicensePhoto, processLicensePhotos };
})();

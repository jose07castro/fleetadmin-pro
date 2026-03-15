/* ============================================
   FleetAdmin Pro — Firebase Storage Utility
   Subida y eliminación de imágenes en Firebase Storage
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

                if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                    if (width > height) {
                        height = Math.round(height * (MAX_DIMENSION / width));
                        width = MAX_DIMENSION;
                    } else {
                        width = Math.round(width * (MAX_DIMENSION / height));
                        height = MAX_DIMENSION;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

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
     * Sube una imagen comprimida a Firebase Storage.
     * @param {string} dataUrl - Data URL (data:image/...).
     * @param {string} path - Ruta en Storage.
     * @returns {Promise<string>} URL pública de descarga.
     */
    async function uploadImage(dataUrl, path) {
        if (!dataUrl || !dataUrl.startsWith('data:')) {
            throw new Error('Dato de imagen inválido');
        }

        const blob = await compressImage(dataUrl);
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        console.log(`📦 Tamaño final: ${sizeMB}MB`);

        const storageRef = firebaseStorage.ref(path);
        const snapshot = await storageRef.put(blob, { contentType: 'image/jpeg' });
        const downloadURL = await snapshot.ref.getDownloadURL();
        return downloadURL;
    }

    /**
     * Elimina un archivo de Firebase Storage por su URL de descarga.
     * @param {string} downloadURL - URL pública del archivo.
     * @returns {Promise<boolean>} true si se eliminó, false si ya no existía.
     */
    async function deleteFile(downloadURL) {
        if (!downloadURL || typeof downloadURL !== 'string') return false;

        try {
            // Solo borrar si es una URL de Firebase Storage
            if (!downloadURL.includes('firebasestorage.googleapis.com') &&
                !downloadURL.includes('firebasestorage.app')) {
                console.log('⏭️ No es URL de Storage, saltando:', downloadURL.substring(0, 50));
                return false;
            }

            const fileRef = firebaseStorage.refFromURL(downloadURL);
            await fileRef.delete();
            console.log('🗑️ Archivo eliminado de Storage:', fileRef.fullPath);
            return true;
        } catch (error) {
            if (error.code === 'storage/object-not-found') {
                console.warn('⚠️ Archivo ya no existe en Storage:', downloadURL.substring(0, 80));
                return false;
            }
            console.error('❌ Error eliminando archivo de Storage:', error);
            throw error;
        }
    }

    /**
     * Elimina todas las fotos de licencia de un usuario.
     * @param {object} user - Objeto del usuario con licenseFrontPhoto y licenseBackPhoto.
     * @returns {Promise<{front: boolean, back: boolean}>}
     */
    async function deleteUserPhotos(user) {
        const result = { front: false, back: false };

        if (user.licenseFrontPhoto) {
            try {
                result.front = await deleteFile(user.licenseFrontPhoto);
            } catch (e) {
                console.warn('⚠️ No se pudo borrar foto frente:', e.message);
            }
        }

        if (user.licenseBackPhoto) {
            try {
                result.back = await deleteFile(user.licenseBackPhoto);
            } catch (e) {
                console.warn('⚠️ No se pudo borrar foto dorso:', e.message);
            }
        }

        return result;
    }

    /**
     * Sube foto de licencia (frente o dorso).
     */
    async function uploadLicensePhoto(dataUrl, userId, side) {
        const fleetId = Auth.getFleetId() || 'default';
        const timestamp = Date.now();
        const path = `licencias/${fleetId}/${userId}_${side}_${timestamp}.jpg`;
        return await uploadImage(dataUrl, path);
    }

    /**
     * Procesa fotos: BORRA las viejas de Storage y sube las nuevas.
     * @param {object} user - Objeto del usuario a actualizar.
     * @param {string|null} frontData - Data URL nueva de frente (null = no cambiar).
     * @param {string|null} backData - Data URL nueva de dorso (null = no cambiar).
     * @returns {Promise<object>} user actualizado con URLs de Storage.
     */
    async function processLicensePhotos(user, frontData, backData) {
        let uploadCount = 0;
        const total = (frontData ? 1 : 0) + (backData ? 1 : 0);

        if (total === 0) return user;

        Components.showToast(`📤 Comprimiendo y subiendo fotos...`, 'info');

        try {
            if (frontData) {
                uploadCount++;
                // Borrar foto vieja antes de subir la nueva
                if (user.licenseFrontPhoto) {
                    Components.showToast(`🗑️ Eliminando foto frente anterior...`, 'info');
                    await deleteFile(user.licenseFrontPhoto).catch(() => {});
                }
                Components.showToast(`📤 Subiendo foto frente (${uploadCount}/${total})...`, 'info');
                const frontURL = await uploadLicensePhoto(frontData, user.id, 'front');
                user.licenseFrontPhoto = frontURL;
                console.log('✅ Frente subida:', frontURL);
            }

            if (backData) {
                uploadCount++;
                // Borrar foto vieja antes de subir la nueva
                if (user.licenseBackPhoto) {
                    Components.showToast(`🗑️ Eliminando foto dorso anterior...`, 'info');
                    await deleteFile(user.licenseBackPhoto).catch(() => {});
                }
                Components.showToast(`📤 Subiendo foto dorso (${uploadCount}/${total})...`, 'info');
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

    /**
     * Elimina UNA SOLA foto (frente o dorso) de un conductor.
     * Usa update() directo para tocar SOLO ese campo — no toca otros datos.
     * Actualiza el DOM sin reabrir el modal.
     * @param {string} userId - ID del usuario en la flota.
     * @param {string} side - 'front' o 'back'.
     * @param {string} calledFrom - 'dashboard' o 'settings' (no usado, se actualiza in-place).
     */
    async function deleteSinglePhoto(userId, side, calledFrom) {
        const label = side === 'front' ? 'FRENTE' : 'DORSO';
        if (!confirm(`¿Eliminar la foto ${label} de la licencia?\n\nSe borrará del servidor permanentemente.`)) return;

        try {
            Components.showToast(`🗑️ Eliminando foto ${label}...`, 'info');

            // Leer SOLO la URL de la foto para borrarla de Storage
            const user = await DB.get('users', userId);
            if (!user) {
                alert('Error: Usuario no encontrado');
                return;
            }

            const fieldName = side === 'front' ? 'licenseFrontPhoto' : 'licenseBackPhoto';
            const photoURL = user[fieldName];

            // 1. Borrar de Firebase Storage
            if (photoURL) {
                await deleteFile(photoURL);
            }

            // 2. Actualizar SOLO el campo de la foto en la DB (NO tocar nada más)
            const fleetId = Auth.getFleetId();
            const updateData = {};
            updateData[fieldName] = null;
            updateData['updatedAt'] = new Date().toISOString();
            await firebaseDB.ref(`fleets/${fleetId}/users/${userId}`).update(updateData);

            Components.showToast(`✅ Foto ${label} eliminada`, 'success');
            console.log(`🗑️ Foto ${label} eliminada para usuario ${userId}`);

            // 3. Actualizar la UI EN EL LUGAR (sin reabrir el modal)
            // Buscar el contenedor de la foto y reemplazarlo
            const previewId = side === 'front' ? 'editLicenseFrontPreview' : 'editLicenseBackPreview';
            const dataId = side === 'front' ? 'editLicenseFrontData' : 'editLicenseBackData';

            // Buscar el bloque de la foto actual (el div con la miniatura y el botón eliminar)
            // y reemplazarlo con el indicador de "no cargada"
            const previewEl = document.getElementById(previewId);
            const dataEl = document.getElementById(dataId);

            // Limpiar el hidden input por si había una foto nueva pendiente
            if (dataEl) dataEl.value = '';
            if (previewEl) previewEl.innerHTML = '';

            // Buscar el img de la foto existente en el form-group padre
            if (previewEl) {
                const formGroup = previewEl.closest('.form-group');
                if (formGroup) {
                    // Buscar y remover el div que contiene la miniatura + botón eliminar
                    const photoDiv = formGroup.querySelector('div[style*="position:relative"], div[style*="margin-bottom"]');
                    if (photoDiv && photoDiv.querySelector('img')) {
                        photoDiv.innerHTML = '<div style="color:#dc2626; font-weight:700; font-size:12px; margin-bottom:var(--space-2);">❌ No cargada — Eliminada</div>';
                    }
                }
            }

        } catch (error) {
            console.error(`❌ Error eliminando foto ${label}:`, error);
            alert(`Error al eliminar foto ${label}: ${(error.message || error)}`);
        }
    }

    return { compressImage, uploadImage, uploadLicensePhoto, processLicensePhotos, deleteFile, deleteUserPhotos, deleteSinglePhoto };
})();

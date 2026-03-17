/* ============================================
   FleetAdmin Pro — Comunidad de Dueños
   Feed social para administradores de flota
   Datos globales en /community_posts/
   ============================================ */

const CommunityModule = (() => {

    async function render() {
        const posts = await _getPosts();
        const userName = Auth.getUserName();

        return `
            <div class="community-header">
                <div>
                    <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-1);">
                        💬 Comunidad de Dueños
                    </h2>
                    <p style="color:var(--text-secondary); font-size:var(--font-size-sm);">
                        Compartí experiencias, consejos y novedades con otros administradores de flota
                    </p>
                </div>
                <button class="btn btn-ghost" onclick="Router.navigate('dashboard')" style="flex-shrink:0;">
                    ← Volver al Panel
                </button>
            </div>

            <!-- Caja para escribir publicación -->
            <div class="community-compose card">
                <div style="display:flex; gap:var(--space-3); align-items:flex-start;">
                    <div class="community-avatar">${(userName || 'U')[0].toUpperCase()}</div>
                    <div style="flex:1;">
                        <textarea id="communityPostText" class="form-input community-textarea"
                            placeholder="¿Qué querés compartir con la comunidad?" rows="3"
                            maxlength="500"></textarea>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:var(--space-2);">
                            <span id="communityCharCount" style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                0 / 500
                            </span>
                            <button class="btn btn-primary btn-sm community-post-btn" onclick="CommunityModule.submitPost()">
                                📤 Publicar
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Feed de publicaciones -->
            <div class="community-feed" id="communityFeed">
                ${posts.length > 0
                    ? posts.map(p => _renderPost(p)).join('')
                    : `<div class="community-empty">
                        <div style="font-size:3rem; margin-bottom:var(--space-3);">🌟</div>
                        <div style="font-weight:600; margin-bottom:var(--space-1);">¡Sé el primero en publicar!</div>
                        <div style="color:var(--text-tertiary); font-size:var(--font-size-sm);">
                            La comunidad está esperando tus experiencias y consejos.
                        </div>
                    </div>`
                }
            </div>
        `;
    }

    function _renderPost(post) {
        const date = new Date(post.created_at);
        const timeAgo = _timeAgo(date);
        const initial = (post.author_name || '?')[0].toUpperCase();

        return `
            <div class="community-post card">
                <div class="community-post-header">
                    <div class="community-avatar">${initial}</div>
                    <div style="flex:1;">
                        <div class="community-post-author">${post.author_name || 'Anónimo'}</div>
                        <div class="community-post-time">${timeAgo}</div>
                    </div>
                    ${post.fleet_city ? `
                        <span class="community-location-badge">
                            📍 ${post.fleet_city}
                        </span>
                    ` : ''}
                </div>
                <div class="community-post-body">${_escapeHTML(post.content)}</div>
                <div class="community-post-footer">
                    <button class="community-react-btn" onclick="CommunityModule.reactToPost('${post.id}', '👍')">
                        👍 ${post.likes || 0}
                    </button>
                    <button class="community-react-btn" onclick="CommunityModule.reactToPost('${post.id}', '💡')">
                        💡 ${post.insights || 0}
                    </button>
                </div>
            </div>
        `;
    }

    // --- Publicar un post ---
    async function submitPost() {
        const textarea = document.getElementById('communityPostText');
        const content = textarea?.value?.trim();

        if (!content || content.length < 3) {
            Components.showToast('⚠️ Escribí al menos 3 caracteres para publicar.', 'warning');
            return;
        }

        try {
            Components.showToast('📤 Publicando...', 'info');

            // Obtener ciudad de la flota para mostrar en el post
            let fleetCity = '';
            try {
                const location = await DB.getSetting('location');
                if (location && location.city) {
                    fleetCity = location.city;
                }
            } catch (e) { /* sin ubicación */ }

            const postData = {
                author_id: Auth.getUserId() || Auth.getUserName(),
                author_name: Auth.getUserName(),
                fleet_id: Auth.getFleetId(),
                fleet_city: fleetCity,
                content: content,
                likes: 0,
                insights: 0
            };

            await _addPost(postData);

            Components.showToast('✅ ¡Publicación enviada!', 'success');
            Router.navigate('community');
        } catch (error) {
            console.error('❌ Error publicando en comunidad:', error);
            Components.showToast('❌ Error al publicar: ' + (error.message || error), 'danger');
        }
    }

    // --- Reaccionar a un post ---
    async function reactToPost(postId, type) {
        try {
            const field = type === '👍' ? 'likes' : 'insights';
            const ref = firebaseDB.ref(`community_posts/${postId}/${field}`);
            await ref.transaction(current => (current || 0) + 1);
            // Refrescar
            Router.navigate('community');
        } catch (e) {
            console.warn('Error al reaccionar:', e);
        }
    }

    // --- afterRender: configurar contador de caracteres ---
    function afterRender() {
        const textarea = document.getElementById('communityPostText');
        const counter = document.getElementById('communityCharCount');
        if (textarea && counter) {
            textarea.addEventListener('input', () => {
                counter.textContent = `${textarea.value.length} / 500`;
            });
        }
    }

    // --- Helpers de Firebase ---
    async function _addPost(data) {
        const ref = firebaseDB.ref('community_posts').push();
        const post = {
            ...data,
            id: ref.key,
            created_at: new Date().toISOString()
        };
        await ref.set(post);
        return ref.key;
    }

    async function _getPosts() {
        try {
            const snap = await firebaseDB.ref('community_posts')
                .orderByChild('created_at')
                .limitToLast(50)
                .once('value');
            const val = snap.val();
            if (!val) return [];
            return Object.values(val)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (e) {
            console.warn('Error cargando posts de comunidad:', e);
            return [];
        }
    }

    // --- Utilidades ---
    function _timeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'hace un momento';
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `hace ${mins} min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `hace ${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `hace ${days}d`;
        return date.toLocaleDateString();
    }

    function _escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { render, afterRender, submitPost, reactToPost };
})();

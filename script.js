/* script.js */
const App = {
    db: null,
    tmdbKey: '',
    tmdbBaseUrl: 'https://api.themoviedb.org/3',
    imgBaseUrl: 'https://image.tmdb.org/t/p/w342',
    imgBackdropUrl: 'https://image.tmdb.org/t/p/w780',
    currentView: 'view-home',
    searchPage: 1,
    searchQuery: '',
    currentMediaCache: null, // Holds TMDB fetched details temporarily
    state: {
        libraries: [],
        media: [], // Local collection
        reminders: []
    },

    async init() {
        await this.initDB();
        await this.loadSettings();
        await this.loadData();
        
        this.initRouter();
        this.initEventListeners();
        this.renderSidebarLibraries();
        this.navigate(window.location.hash || '#home');
        
        this.checkReminders();
        // Check for new reminders every 30 seconds while the app is open
        setInterval(() => this.checkReminders(), 30000);
    },

    // --- IndexedDB Wrapper ---
    initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('EntertainmentLibrary', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
                if (!db.objectStoreNames.contains('libraries')) db.createObjectStore('libraries', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('reminders')) db.createObjectStore('reminders', { keyPath: 'id' });
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async idbGet(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = key ? store.get(key) : store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async idbPut(storeName, value, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = key ? store.put(value, key) : store.put(value);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async idbDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = key ? store.delete(key) : store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    // --- Data Loading & Settings ---
    async loadSettings() {
        const key = await this.idbGet('settings', 'tmdbKey');
        const theme = await this.idbGet('settings', 'theme') || 'dark';
        const accent = await this.idbGet('settings', 'accent') || '#3b82f6';
        
        this.tmdbKey = key || '';
        document.getElementById('setting-tmdb-key').value = this.tmdbKey;
        document.getElementById('setting-theme').value = theme;
        document.getElementById('setting-accent').value = accent;
        
        this.applyTheme(theme, accent);
    },

    async saveSettings() {
        const key = document.getElementById('setting-tmdb-key').value.trim();
        const theme = document.getElementById('setting-theme').value;
        const accent = document.getElementById('setting-accent').value;
        
        await this.idbPut('settings', key, 'tmdbKey');
        await this.idbPut('settings', theme, 'theme');
        await this.idbPut('settings', accent, 'accent');
        
        this.tmdbKey = key;
        this.applyTheme(theme, accent);
        this.showToast('Settings saved successfully.');
    },

    applyTheme(theme, accent) {
        if (theme === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        } else {
            document.documentElement.dataset.theme = theme;
        }
        document.documentElement.style.setProperty('--accent-color', accent);
    },

    async loadData() {
        this.state.libraries = await this.idbGet('libraries') || [];
        this.state.media = await this.idbGet('media') || [];
        this.state.reminders = await this.idbGet('reminders') || [];
    },

    // --- Routing & Navigation ---
    initRouter() {
        window.addEventListener('hashchange', () => this.navigate(window.location.hash));
    },

    navigate(hash) {
        if (!hash) hash = '#home';
        
        // Handle dynamic routes like #library_123 or #media_m_456
        let viewId = 'view-home';
        let param = null;
        
        if (hash.startsWith('#library_')) {
            viewId = 'view-library';
            param = hash.replace('#library_', '');
        } else if (hash.startsWith('#media_')) {
            viewId = 'view-media';
            param = hash.replace('#media_', '');
        } else {
            const link = document.querySelector(`a[href="${hash}"]`);
            if (link) viewId = link.getAttribute('data-view');
        }

        // Hide all, show target
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(viewId);
        if (targetView) targetView.classList.add('active');

        // Update active nav state
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-links a[href="${hash}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            document.getElementById('mobile-header-title').textContent = activeLink.textContent.trim();
        } else if (viewId === 'view-library') {
            const lib = this.state.libraries.find(l => l.id === param);
            if (lib) document.getElementById('mobile-header-title').textContent = lib.name;
        } else if (viewId === 'view-media') {
            document.getElementById('mobile-header-title').textContent = 'Details';
        }

        this.currentView = viewId;
        this.closeMobileMenu();
        this.renderView(viewId, hash, param);
    },

    renderView(viewId, hash, param) {
        window.scrollTo(0,0);
        switch (viewId) {
            case 'view-home': this.renderHome(); break;
            case 'view-search': 
                if(!this.tmdbKey) {
                    document.getElementById('search-state-message').innerHTML = 'Please add your TMDB API Key in <a href="#settings">Settings</a> to search.';
                }
                break;
            case 'view-status': 
                const link = document.querySelector(`a[href="${hash}"]`);
                if(link) this.renderStatusList(link.getAttribute('data-status')); 
                break;
            case 'view-library': this.renderLibraryDetail(param); break;
            case 'view-media': this.fetchAndRenderMedia(param); break;
            case 'view-reminders': this.renderRemindersView(); break;
        }
    },

    // --- DOM Event Listeners ---
    initEventListeners() {
        // Mobile Menu
        document.getElementById('mobile-menu-open').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
        document.getElementById('mobile-menu-close').addEventListener('click', this.closeMobileMenu.bind(this));

        // Settings
        document.getElementById('btn-save-key').addEventListener('click', () => this.saveSettings());
        document.getElementById('setting-theme').addEventListener('change', () => this.saveSettings());
        document.getElementById('setting-accent').addEventListener('change', () => this.saveSettings());

        // Modals Close
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => e.target.closest('.modal-overlay').classList.add('hidden'));
        });

        // Search
        let searchTimeout;
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');
        
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            searchClear.classList.toggle('hidden', val.length === 0);
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.searchQuery = val;
                this.searchPage = 1;
                this.performSearch();
            }, 500);
        });

        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            this.searchQuery = '';
            searchClear.classList.add('hidden');
            document.getElementById('search-results').innerHTML = '';
            document.getElementById('search-state-message').classList.remove('hidden');
            document.getElementById('search-state-message').textContent = 'Start typing to search TMDB catalog...';
            document.getElementById('search-load-more').classList.add('hidden');
        });

        document.querySelectorAll('input[name="search-type"]').forEach(radio => {
            radio.addEventListener('change', () => { this.searchPage = 1; this.performSearch(); });
        });

        document.getElementById('btn-load-more').addEventListener('click', () => {
            this.searchPage++;
            this.performSearch(true);
        });

        // Libraries
        document.getElementById('btn-new-library-nav').addEventListener('click', () => this.openLibraryModal());
        document.getElementById('btn-home-new-lib').addEventListener('click', () => this.openLibraryModal());
        document.getElementById('form-library').addEventListener('submit', (e) => this.handleLibrarySubmit(e));
        
        // Media Management
        document.getElementById('btn-media-status').addEventListener('click', () => this.openMediaManageModal());
        document.getElementById('form-media-manage').addEventListener('submit', (e) => this.handleMediaManageSubmit(e));
        document.getElementById('btn-remove-media').addEventListener('click', () => this.removeMediaFromCollection());
        document.getElementById('manage-status').addEventListener('change', (e) => {
            const type = document.getElementById('manage-media-id').value.split('_')[0];
            const isTracking = e.target.value !== 'None' && e.target.value !== 'Planned';
            document.getElementById('manage-tv-progress').style.display = (type === 'tv' && isTracking) ? 'block' : 'none';
        });
        document.getElementById('btn-manage-new-lib').addEventListener('click', () => this.openLibraryModal());

        // Back button in media view
        document.getElementById('btn-media-back').addEventListener('click', () => window.history.back());

        // Reminders
        document.getElementById('btn-media-reminder').addEventListener('click', () => this.openReminderModal(true));
        document.getElementById('btn-new-reminder').addEventListener('click', () => this.openReminderModal());
        document.getElementById('form-reminder').addEventListener('submit', (e) => this.handleReminderSubmit(e));
        document.getElementById('btn-delete-reminder').addEventListener('click', () => this.deleteReminder());

        // Sorts & Library Searching
        document.getElementById('status-sort').addEventListener('change', () => {
            const status = document.querySelector('.nav-links a.active').getAttribute('data-status');
            this.renderStatusList(status);
        });
        document.getElementById('lib-sort').addEventListener('change', () => {
            const libId = window.location.hash.replace('#library_', '');
            this.renderLibraryDetail(libId);
        });
        document.getElementById('lib-search').addEventListener('input', () => {
            const libId = window.location.hash.replace('#library_', '');
            this.renderLibraryDetail(libId);
        });

        // Library Detail Actions
        document.getElementById('btn-lib-edit').addEventListener('click', () => {
            const libId = window.location.hash.replace('#library_', '');
            this.openLibraryModal(libId);
        });
        document.getElementById('btn-lib-delete').addEventListener('click', () => {
            const libId = window.location.hash.replace('#library_', '');
            if(confirm('Are you sure you want to delete this library? Titles inside will remain in your collection.')) {
                this.deleteLibrary(libId);
            }
        });
        document.getElementById('btn-lib-share').addEventListener('click', () => {
            const libId = window.location.hash.replace('#library_', '');
            this.exportLibrary(libId);
        });

        // Backup / Import
        document.getElementById('btn-export-backup').addEventListener('click', () => this.exportBackup());
        document.getElementById('btn-import-backup').addEventListener('click', () => document.getElementById('file-import-backup').click());
        document.getElementById('file-import-backup').addEventListener('change', (e) => this.handleImport(e, 'backup'));
        
        document.getElementById('btn-import-library').addEventListener('click', () => document.getElementById('file-import-library').click());
        document.getElementById('file-import-library').addEventListener('change', (e) => this.handleImport(e, 'library'));

        document.getElementById('btn-confirm-import').addEventListener('click', () => this.processLibraryImport());

        document.getElementById('btn-clear-data').addEventListener('click', async () => {
            if(confirm('WARNING: This will permanently delete all your libraries, statuses, and settings. Are you sure?')) {
                await this.idbDelete('libraries');
                await this.idbDelete('media');
                await this.idbDelete('reminders');
                localStorage.clear();
                window.location.reload();
            }
        });
    },

    closeMobileMenu() {
        document.getElementById('sidebar').classList.remove('open');
    },

    // --- Renderers ---

    renderHome() {
        const watching = this.state.media.filter(m => m.status === 'Watching').sort((a,b) => b.addedAt - a.addedAt);
        const recent = [...this.state.media].sort((a,b) => b.addedAt - a.addedAt).slice(0, 10);
        
        this.renderPosterScroll('home-watching-grid', watching);
        document.getElementById('home-watching-section').style.display = watching.length ? 'block' : 'none';

        this.renderPosterScroll('home-recent-grid', recent);
        document.getElementById('home-recent-section').style.display = recent.length ? 'block' : 'none';

        const libsGrid = document.getElementById('home-libraries-grid');
        libsGrid.innerHTML = '';
        this.state.libraries.forEach(lib => {
            const count = this.state.media.filter(m => m.libraries.includes(lib.id)).length;
            const card = document.createElement('div');
            card.className = 'lib-card';
            card.onclick = () => window.location.hash = `#library_${lib.id}`;
            card.innerHTML = `
                <div class="lib-icon-large">${lib.icon}</div>
                <div class="lib-card-info">
                    <h3 style="color: ${lib.color}">${this.escapeHtml(lib.name)}</h3>
                    <p>${count} items</p>
                </div>
            `;
            libsGrid.appendChild(card);
        });

        // Reminders on home
        const upcoming = this.state.reminders.filter(r => new Date(r.date) >= new Date(new Date().setHours(0,0,0,0)))
            .sort((a,b) => new Date(a.date) - new Date(b.date)).slice(0,3);
        
        const remList = document.getElementById('home-reminders-list');
        remList.innerHTML = '';
        if(upcoming.length) {
            document.getElementById('home-reminders-section').style.display = 'block';
            upcoming.forEach(rem => {
                remList.insertAdjacentHTML('beforeend', `
                    <div class="reminder-item" style="margin-bottom: 0.5rem; cursor: pointer;" onclick="window.location.hash='#reminders'">
                        <div class="reminder-info">
                            <h4>${this.escapeHtml(rem.title)}</h4>
                            <div class="reminder-meta">${rem.date} ${rem.time ? 'at ' + rem.time : ''} • ${rem.targetName}</div>
                        </div>
                    </div>
                `);
            });
        } else {
            document.getElementById('home-reminders-section').style.display = 'none';
        }
    },

    renderSidebarLibraries() {
        const container = document.getElementById('nav-custom-libraries');
        container.innerHTML = '';
        this.state.libraries.forEach(lib => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="#library_${lib.id}" data-view="view-library">
                <span style="font-size: 1.1rem; width: 20px; text-align:center;">${lib.icon}</span> 
                ${this.escapeHtml(lib.name)}
            </a>`;
            container.appendChild(li);
        });
    },

    renderPosterScroll(containerId, mediaArray) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        mediaArray.forEach(media => container.appendChild(this.createMediaCard(media)));
    },

    renderStatusList(status) {
        document.getElementById('status-title').textContent = status === 'Planned' ? 'Watchlist' : status;
        let list = this.state.media.filter(m => m.status === status);
        
        const sort = document.getElementById('status-sort').value;
        list = this.sortMedia(list, sort);

        const grid = document.getElementById('status-grid');
        grid.innerHTML = '';
        document.getElementById('status-empty').classList.toggle('hidden', list.length > 0);
        
        list.forEach(media => grid.appendChild(this.createMediaCard(media)));
    },

    renderLibraryDetail(libId) {
        const lib = this.state.libraries.find(l => l.id === libId);
        if(!lib) return this.navigate('#home');

        document.getElementById('lib-detail-icon').textContent = lib.icon;
        document.getElementById('lib-detail-name').textContent = lib.name;
        document.getElementById('lib-detail-name').style.color = lib.color;
        document.getElementById('lib-detail-desc').textContent = lib.desc || '';
        
        let list = this.state.media.filter(m => m.libraries && m.libraries.includes(lib.id));
        document.getElementById('lib-detail-count').textContent = `${list.length} items`;

        // Search Filter
        const searchQ = document.getElementById('lib-search').value.toLowerCase();
        if(searchQ) list = list.filter(m => m.title.toLowerCase().includes(searchQ));

        // Sort
        const sort = document.getElementById('lib-sort').value;
        if(sort !== 'manual') list = this.sortMedia(list, sort);

        const grid = document.getElementById('lib-grid');
        grid.innerHTML = '';
        document.getElementById('lib-empty').classList.toggle('hidden', list.length > 0);
        
        list.forEach(media => grid.appendChild(this.createMediaCard(media)));
    },

    sortMedia(list, sortOption) {
        return list.sort((a, b) => {
            switch(sortOption) {
                case 'dateAdded-desc': return b.addedAt - a.addedAt;
                case 'title-asc': return a.title.localeCompare(b.title);
                case 'rating-desc': return (b.rating || 0) - (a.rating || 0);
                case 'release-desc': 
                    return new Date(b.releaseDate || '1970').getTime() - new Date(a.releaseDate || '1970').getTime();
                default: return 0;
            }
        });
    },

    createMediaCard(media) {
        const div = document.createElement('div');
        div.className = 'media-card';
        div.onclick = () => window.location.hash = `#media_${media.type}_${media.tmdbId}`;
        
        const img = media.posterPath ? `${this.imgBaseUrl}${media.posterPath}` : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" background="%23333"></svg>';
        const year = media.releaseDate ? media.releaseDate.substring(0,4) : 'Unknown';
        
        let badge = '';
        if (media.status) {
            const colors = { 'Watching': 'var(--accent-color)', 'Completed': 'var(--success-color)'};
            badge = `<div class="card-badge" style="background-color: ${colors[media.status] || 'rgba(0,0,0,0.7)'}">${media.status}</div>`;
        }

        div.innerHTML = `
            <div class="poster-wrapper">
                <img src="${img}" alt="${this.escapeHtml(media.title)}" class="poster-img" loading="lazy">
                ${badge}
            </div>
            <div class="media-card-title">${this.escapeHtml(media.title)}</div>
            <div class="media-card-meta">${year} • ${media.type === 'movie' ? 'Movie' : 'TV'}</div>
        `;
        return div;
    },

    // --- Search & TMDB ---
    async performSearch(append = false) {
        if (!this.tmdbKey || !this.searchQuery) return;
        
        const type = document.querySelector('input[name="search-type"]:checked').value;
        const msg = document.getElementById('search-state-message');
        const grid = document.getElementById('search-results');
        const loadMore = document.getElementById('search-load-more');
        
        if (!append) {
            grid.innerHTML = '';
            msg.textContent = 'Searching...';
            msg.classList.remove('hidden');
            loadMore.classList.add('hidden');
        }

        try {
            const url = `${this.tmdbBaseUrl}/search/${type}?api_key=${this.tmdbKey}&query=${encodeURIComponent(this.searchQuery)}&page=${this.searchPage}&include_adult=false`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.results.length === 0 && !append) {
                msg.textContent = 'No results found.';
                return;
            }
            msg.classList.add('hidden');

            data.results.forEach(item => {
                if (item.media_type === 'person') return;
                
                // Format to our internal media structure loosely for the card
                const mType = type === 'multi' ? item.media_type : type;
                const mediaObj = {
                    tmdbId: item.id,
                    type: mType,
                    title: item.title || item.name,
                    posterPath: item.poster_path,
                    releaseDate: item.release_date || item.first_air_date
                };
                grid.appendChild(this.createMediaCard(mediaObj));
            });

            loadMore.classList.toggle('hidden', data.page >= data.total_pages);
        } catch (error) {
            msg.textContent = 'Error fetching from TMDB. Check API Key or network.';
            msg.classList.remove('hidden');
        }
    },

    async fetchAndRenderMedia(param) {
        // param = "movie_12345" or "tv_67890"
        const [type, tmdbIdStr] = param.split('_');
        const tmdbId = parseInt(tmdbIdStr);
        
        // Setup empty state while loading
        document.getElementById('media-detail-backdrop').src = '';
        document.getElementById('media-detail-poster').src = '';
        document.getElementById('media-detail-title').textContent = 'Loading...';
        document.getElementById('media-detail-synopsis').textContent = '';
        
        // Clear any old tagline that might exist
        const oldTagline = document.getElementById('media-tagline');
        if (oldTagline) oldTagline.remove();

        document.getElementById('media-detail-meta').innerHTML = '';
        document.getElementById('media-detail-genres').innerHTML = '';
        document.getElementById('media-detail-cast').innerHTML = '';
        document.getElementById('media-user-data').classList.add('hidden');
        document.getElementById('media-tv-seasons-container').classList.add('hidden');

        let data = null;
        try {
            if(!this.tmdbKey) throw new Error("No API Key");
            const res = await fetch(`${this.tmdbBaseUrl}/${type}/${tmdbId}?api_key=${this.tmdbKey}&append_to_response=credits`);
            data = await res.json();
            this.currentMediaCache = { ...data, media_type: type };
        } catch (err) {
            this.showToast('Unable to fetch media details from TMDB.');
            return;
        }

        // Render Details
        const title = data.title || data.name;
        const originalTitle = data.original_title || data.original_name;
        const releaseDate = data.release_date || data.first_air_date || '';
        const year = releaseDate ? releaseDate.substring(0,4) : '';
        
        document.getElementById('media-detail-title').textContent = title;
        document.getElementById('media-detail-original-title').textContent = originalTitle !== title ? originalTitle : '';
        document.getElementById('media-detail-synopsis').textContent = data.overview || 'No synopsis available.';
        
        // Insert Tagline if it exists
        if (data.tagline) {
            document.getElementById('media-detail-synopsis').insertAdjacentHTML('beforebegin', `<p id="media-tagline" style="font-style: italic; color: var(--text-muted); margin-bottom: 1rem;">"${this.escapeHtml(data.tagline)}"</p>`);
        }

        if (data.backdrop_path) document.getElementById('media-detail-backdrop').src = `${this.imgBackdropUrl}${data.backdrop_path}`;
        if (data.poster_path) document.getElementById('media-detail-poster').src = `${this.imgBaseUrl}${data.poster_path}`;

        // Meta tags
        let metaHtml = `<span>${year}</span><span>•</span><span>${type === 'movie' ? 'Movie' : 'TV Show'}</span>`;
        if (data.runtime || (data.episode_run_time && data.episode_run_time[0])) {
            metaHtml += `<span>•</span><span>${data.runtime || data.episode_run_time[0]} min</span>`;
        }
        document.getElementById('media-detail-meta').innerHTML = metaHtml;

        // Genres
        document.getElementById('media-detail-genres').innerHTML = (data.genres || []).map(g => `<span class="genre-tag">${g.name}</span>`).join('');
        
        // Status & Prod
        document.getElementById('media-detail-release-status').textContent = data.status || '-';
        document.getElementById('media-detail-production').textContent = data.production_companies?.[0]?.name || '-';

        // Cast
        const castContainer = document.getElementById('media-detail-cast');
        if (data.credits && data.credits.cast) {
            data.credits.cast.slice(0, 10).forEach(person => {
                castContainer.insertAdjacentHTML('beforeend', `
                    <div style="min-width: 100px; text-align: center;">
                        <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--surface-color); margin: 0 auto 0.5rem; overflow: hidden;">
                            ${person.profile_path ? `<img src="https://image.tmdb.org/t/p/w185${person.profile_path}" style="width:100%;height:100%;object-fit:cover;">` : ''}
                        </div>
                        <div style="font-size: 0.8rem; font-weight: bold; line-height:1.2;">${this.escapeHtml(person.name)}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); line-height:1.2;">${this.escapeHtml(person.character)}</div>
                    </div>
                `);
            });
        }

        // Handle TV Seasons and Episodes Rendering
        const seasonsContainer = document.getElementById('media-tv-seasons-container');
        const seasonSelect = document.getElementById('tv-season-select');
        const episodesList = document.getElementById('tv-episodes-list');
        
        if (type === 'tv' && data.seasons && data.seasons.length > 0) {
            seasonsContainer.classList.remove('hidden');
            seasonSelect.innerHTML = '';
            
            // Exclude season 0 (Specials) usually, unless it's the only season
            const validSeasons = data.seasons.filter(s => s.season_number > 0 || data.seasons.length === 1);
            
            validSeasons.forEach(season => {
                const opt = document.createElement('option');
                opt.value = season.season_number;
                opt.textContent = `${season.name} (${season.episode_count} Episodes)`;
                seasonSelect.appendChild(opt);
            });
            
            if (validSeasons.length > 0) {
                this.fetchAndRenderSeasonEpisodes(tmdbId, validSeasons[0].season_number);
            }
            
            seasonSelect.onchange = (e) => {
                this.fetchAndRenderSeasonEpisodes(tmdbId, e.target.value);
            };
        } else {
            seasonsContainer.classList.add('hidden');
            seasonSelect.innerHTML = '';
            episodesList.innerHTML = '';
        }

        // Check if in local collection
        const localId = `${type}_${tmdbId}`;
        const localMedia = this.state.media.find(m => m.id === localId);
        
        const btnStatus = document.getElementById('btn-media-status');
        if (localMedia) {
            btnStatus.textContent = 'Edit Tracked Status';
            btnStatus.classList.replace('btn-primary', 'btn-outline');
            this.renderLocalMediaInfoPanel(localMedia);
        } else {
            btnStatus.textContent = 'Add to Collection';
            btnStatus.classList.replace('btn-outline', 'btn-primary');
        }
    },

    async fetchAndRenderSeasonEpisodes(tmdbId, seasonNumber) {
        const episodesList = document.getElementById('tv-episodes-list');
        episodesList.innerHTML = '<div class="text-subtle text-center" style="padding: 1rem;">Loading episodes...</div>';
        
        try {
            const res = await fetch(`${this.tmdbBaseUrl}/tv/${tmdbId}/season/${seasonNumber}?api_key=${this.tmdbKey}`);
            const data = await res.json();
            
            episodesList.innerHTML = '';
            
            if (!data.episodes || data.episodes.length === 0) {
                episodesList.innerHTML = '<div class="text-subtle">No episodes found for this season.</div>';
                return;
            }
            
            data.episodes.forEach(ep => {
                const img = ep.still_path ? `${this.imgBaseUrl}${ep.still_path}` : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" background="%23333"></svg>';
                const runtime = ep.runtime ? `${ep.runtime} min` : '';
                const date = ep.air_date || 'Unknown Date';
                
                episodesList.insertAdjacentHTML('beforeend', `
                    <div class="episode-item">
                        <img src="${img}" alt="${this.escapeHtml(ep.name)}" class="episode-img" loading="lazy">
                        <div class="episode-info">
                            <div class="episode-title">
                                <span>${ep.episode_number}. ${this.escapeHtml(ep.name)}</span>
                                <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted);">${runtime}</span>
                            </div>
                            <div class="episode-meta">${date}</div>
                            <div class="episode-desc">${this.escapeHtml(ep.overview || 'No synopsis available for this episode.')}</div>
                        </div>
                    </div>
                `);
            });
        } catch (err) {
            episodesList.innerHTML = '<div class="text-danger">Failed to load episodes.</div>';
        }
    },

    renderLocalMediaInfoPanel(media) {
        const panel = document.getElementById('media-user-data');
        panel.classList.remove('hidden');
        
        document.getElementById('user-data-status').textContent = media.status || 'None';
        document.getElementById('user-data-rating').textContent = media.rating ? `${media.rating}/10` : '-';
        
        if (media.type === 'tv' && media.status && media.status !== 'Planned') {
            document.getElementById('tv-progress-container').style.display = 'block';
            document.getElementById('user-data-season').textContent = media.season || 1;
            document.getElementById('user-data-episode').textContent = media.episode || 0;
        } else {
            document.getElementById('tv-progress-container').style.display = 'none';
        }

        const libs = this.state.libraries.filter(l => media.libraries.includes(l.id));
        document.getElementById('user-data-libraries').innerHTML = libs.map(l => `<span class="badge" style="border-color:${l.color}; color:${l.color}">${this.escapeHtml(l.name)}</span>`).join('') || '<span class="text-subtle">None</span>';
        
        document.getElementById('user-data-notes').textContent = media.notes || '';
        document.getElementById('user-data-notes-container').style.display = media.notes ? 'block' : 'none';
    },

    // --- Media Management (Adding/Editing to DB) ---
    openMediaManageModal() {
        if (!this.currentMediaCache) return;
        const m = this.currentMediaCache;
        const localId = `${m.media_type}_${m.id}`;
        const localMedia = this.state.media.find(x => x.id === localId) || {};

        document.getElementById('manage-media-id').value = localId;
        document.getElementById('manage-status').value = localMedia.status || 'None';
        document.getElementById('manage-rating').value = localMedia.rating || '';
        document.getElementById('manage-favorite').checked = localMedia.isFavorite || false;
        document.getElementById('manage-notes').value = localMedia.notes || '';
        
        if (m.media_type === 'tv') {
            document.getElementById('manage-season').value = localMedia.season || 1;
            document.getElementById('manage-episode').value = localMedia.episode || 0;
            document.getElementById('manage-tv-progress').style.display = (localMedia.status && localMedia.status !== 'Planned' && localMedia.status !== 'None') ? 'block' : 'none';
        } else {
            document.getElementById('manage-tv-progress').style.display = 'none';
        }

        // Render library checkboxes
        const libList = document.getElementById('manage-libraries-list');
        libList.innerHTML = '';
        this.state.libraries.forEach(lib => {
            const isChecked = localMedia.libraries && localMedia.libraries.includes(lib.id) ? 'checked' : '';
            libList.insertAdjacentHTML('beforeend', `
                <label>
                    <input type="checkbox" name="manage-lib-check" value="${lib.id}" ${isChecked}>
                    ${lib.icon} ${this.escapeHtml(lib.name)}
                </label>
            `);
        });

        document.getElementById('btn-remove-media').classList.toggle('hidden', !localMedia.addedAt);
        document.getElementById('modal-media-manage').classList.remove('hidden');
    },

    async handleMediaManageSubmit(e) {
        e.preventDefault();
        if (!this.currentMediaCache) return;

        const m = this.currentMediaCache;
        const localId = `${m.media_type}_${m.id}`;
        let localMedia = this.state.media.find(x => x.id === localId);

        const status = document.getElementById('manage-status').value;
        const selectedLibs = Array.from(document.querySelectorAll('input[name="manage-lib-check"]:checked')).map(cb => cb.value);

        if (status === 'None' && selectedLibs.length === 0) {
            // Remove if no status and no libraries
            if(localMedia) this.removeMediaFromCollection();
            document.getElementById('modal-media-manage').classList.add('hidden');
            return;
        }

        if (!localMedia) {
            localMedia = {
                id: localId,
                tmdbId: m.id,
                type: m.media_type,
                title: m.title || m.name,
                posterPath: m.poster_path,
                backdropPath: m.backdrop_path,
                releaseDate: m.release_date || m.first_air_date,
                addedAt: Date.now()
            };
        }

        localMedia.status = status !== 'None' ? status : null;
        localMedia.rating = document.getElementById('manage-rating').value || null;
        localMedia.isFavorite = document.getElementById('manage-favorite').checked;
        localMedia.notes = document.getElementById('manage-notes').value.trim();
        localMedia.libraries = selectedLibs;

        if (m.media_type === 'tv' && status !== 'Planned' && status !== 'None') {
            localMedia.season = parseInt(document.getElementById('manage-season').value) || 1;
            localMedia.episode = parseInt(document.getElementById('manage-episode').value) || 0;
        }

        // Save
        await this.idbPut('media', localMedia);
        
        // Update local state
        const index = this.state.media.findIndex(x => x.id === localId);
        if (index > -1) this.state.media[index] = localMedia;
        else this.state.media.push(localMedia);

        this.showToast('Saved to collection.');
        document.getElementById('modal-media-manage').classList.add('hidden');
        this.fetchAndRenderMedia(localId); // re-render
    },

    async removeMediaFromCollection() {
        const id = document.getElementById('manage-media-id').value;
        if(confirm('Remove this title from your collection and all libraries?')) {
            await this.idbDelete('media', id);
            this.state.media = this.state.media.filter(m => m.id !== id);
            
            // Clean up related reminders
            const rems = this.state.reminders.filter(r => r.mediaId === id);
            for(let r of rems) await this.idbDelete('reminders', r.id);
            this.state.reminders = this.state.reminders.filter(r => r.mediaId !== id);

            this.showToast('Removed from collection.');
            document.getElementById('modal-media-manage').classList.add('hidden');
            this.fetchAndRenderMedia(id);
        }
    },

    // --- Library Management ---
    openLibraryModal(libId = null) {
        const form = document.getElementById('form-library');
        form.reset();
        document.getElementById('lib-id').value = '';
        document.getElementById('modal-library-title').textContent = 'Create Library';

        if (libId) {
            const lib = this.state.libraries.find(l => l.id === libId);
            if (lib) {
                document.getElementById('lib-id').value = lib.id;
                document.getElementById('lib-name').value = lib.name;
                document.getElementById('lib-desc').value = lib.desc || '';
                document.getElementById('lib-icon').value = lib.icon || '📁';
                document.getElementById('lib-color').value = lib.color || '#3b82f6';
                document.getElementById('modal-library-title').textContent = 'Edit Library';
            }
        }
        // Ensure Manage modal is hidden if we came from there
        document.getElementById('modal-media-manage').classList.add('hidden');
        document.getElementById('modal-library').classList.remove('hidden');
    },

    async handleLibrarySubmit(e) {
        e.preventDefault();
        const id = document.getElementById('lib-id').value || 'lib_' + Date.now();
        const lib = {
            id: id,
            name: document.getElementById('lib-name').value.trim(),
            desc: document.getElementById('lib-desc').value.trim(),
            icon: document.getElementById('lib-icon').value.trim() || '📁',
            color: document.getElementById('lib-color').value,
            createdAt: document.getElementById('lib-id').value ? undefined : Date.now() // preserve if exists
        };

        const existingIdx = this.state.libraries.findIndex(l => l.id === id);
        if (existingIdx > -1) {
            lib.createdAt = this.state.libraries[existingIdx].createdAt;
            this.state.libraries[existingIdx] = lib;
        } else {
            this.state.libraries.push(lib);
        }

        await this.idbPut('libraries', lib);
        
        this.renderSidebarLibraries();
        document.getElementById('modal-library').classList.add('hidden');
        this.showToast('Library saved.');

        if(this.currentView === 'view-home') this.renderHome();
        if(this.currentView === 'view-library' && window.location.hash === `#library_${id}`) this.renderLibraryDetail(id);
    },

    async deleteLibrary(libId) {
        await this.idbDelete('libraries', libId);
        this.state.libraries = this.state.libraries.filter(l => l.id !== libId);
        
        // Remove this library ID from all media
        for (let m of this.state.media) {
            if (m.libraries && m.libraries.includes(libId)) {
                m.libraries = m.libraries.filter(id => id !== libId);
                await this.idbPut('media', m);
            }
        }

        this.renderSidebarLibraries();
        this.showToast('Library deleted.');
        this.navigate('#home');
    },

    // --- Reminders ---
    openReminderModal(fromMedia = false) {
        document.getElementById('form-reminder').reset();
        document.getElementById('reminder-id').value = '';
        const mediaId = fromMedia && this.currentMediaCache ? `${this.currentMediaCache.media_type}_${this.currentMediaCache.id}` : '';
        document.getElementById('reminder-media-id').value = mediaId;
        
        const targetText = fromMedia && this.currentMediaCache ? (this.currentMediaCache.title || this.currentMediaCache.name) : 'General Reminder';
        document.getElementById('reminder-target-display').textContent = targetText;

        if (fromMedia) {
            document.getElementById('reminder-title').value = `Watch ${targetText}`;
        }
        
        const d = new Date();
        document.getElementById('reminder-date').value = d.toISOString().split('T')[0];
        
        document.getElementById('btn-delete-reminder').classList.add('hidden');
        document.getElementById('modal-reminder').classList.remove('hidden');
    },

    async handleReminderSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('reminder-id').value || 'rem_' + Date.now();
        const rem = {
            id,
            title: document.getElementById('reminder-title').value.trim(),
            date: document.getElementById('reminder-date').value,
            time: document.getElementById('reminder-time').value,
            mediaId: document.getElementById('reminder-media-id').value,
            targetName: document.getElementById('reminder-target-display').textContent
        };

        await this.idbPut('reminders', rem);
        
        const idx = this.state.reminders.findIndex(r => r.id === id);
        if(idx > -1) this.state.reminders[idx] = rem;
        else this.state.reminders.push(rem);

        document.getElementById('modal-reminder').classList.add('hidden');
        this.showToast('Reminder set.');
        if(this.currentView === 'view-reminders') this.renderRemindersView();
        if(this.currentView === 'view-home') this.renderHome();
        this.checkReminders();
    },

    renderRemindersView() {
        const list = [...this.state.reminders].sort((a,b) => new Date(`${a.date}T${a.time||'00:00'}`) - new Date(`${b.date}T${b.time||'00:00'}`));
        const container = document.getElementById('reminders-list-full');
        container.innerHTML = '';
        document.getElementById('reminders-empty').classList.toggle('hidden', list.length > 0);

        list.forEach(rem => {
            const div = document.createElement('div');
            div.className = 'reminder-item';
            
            // Highlight past due
            const isPast = new Date(`${rem.date}T${rem.time||'23:59'}`) < new Date();
            if(isPast) div.style.borderLeftColor = 'var(--danger-color)';

            div.innerHTML = `
                <div class="reminder-info">
                    <h4>${this.escapeHtml(rem.title)}</h4>
                    <div class="reminder-meta">${rem.date} ${rem.time ? 'at ' + rem.time : ''} • Target: ${rem.targetName} ${isPast ? '<span class="text-danger">(Past Due)</span>' : ''}</div>
                </div>
                <div>
                    ${rem.mediaId ? `<button class="btn btn-outline btn-icon" onclick="window.location.hash='#media_${rem.mediaId}'" title="Go to title">➜</button>` : ''}
                    <button class="btn btn-danger-text btn-icon" onclick="App.deleteReminder('${rem.id}')" title="Delete">✗</button>
                </div>
            `;
            container.appendChild(div);
        });
    },

    async deleteReminder(id) {
        if(!id) id = document.getElementById('reminder-id').value;
        if(!id) return;
        
        await this.idbDelete('reminders', id);
        this.state.reminders = this.state.reminders.filter(r => r.id !== id);
        
        document.getElementById('modal-reminder').classList.add('hidden');
        this.showToast('Reminder deleted.');
        if(this.currentView === 'view-reminders') this.renderRemindersView();
        if(this.currentView === 'view-home') this.renderHome();
    },

    playNotificationSound() {
        try {
            // Generates a gentle double-chime using the browser's built-in synthesizer
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            
            const playTone = (freq, startTime) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.5);
            };

            playTone(523.25, ctx.currentTime);       // First note
            playTone(659.25, ctx.currentTime + 0.15); // Second note
        } catch(e) { console.error("Audio failed", e); }
    },

    checkReminders() {
        if ("Notification" in window && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
        
        const now = new Date();
        this.state.reminders.forEach(rem => {
            if (rem.notified) return;
            const targetTime = new Date(`${rem.date}T${rem.time || '12:00'}`);
            
            // If the current time just passed the target time (within 24 hours)
            if (now >= targetTime && now.getTime() - targetTime.getTime() < 86400000) { 
                
                // 1. Play the built-in chime sound
                this.playNotificationSound();
                
                // 2. Show the in-app screen notification
                this.showToast(`🔔 Reminder: ${rem.title}`);
                
                // 3. Show OS desktop notification (if allowed)
                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("Library Reminder", { body: rem.title });
                }
                
                // Mark as notified and save so it doesn't trigger again
                rem.notified = true;
                this.idbPut('reminders', rem);
            }
        });
    },

    // --- Import / Export / Sharing ---
    downloadJSON(data, filename) {
        const str = JSON.stringify(data, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async exportBackup() {
        const data = {
            version: 1,
            type: 'full_backup',
            timestamp: Date.now(),
            libraries: this.state.libraries,
            media: this.state.media,
            reminders: this.state.reminders
        };
        this.downloadJSON(data, `Library_Backup_${new Date().toISOString().split('T')[0]}.json`);
    },

    exportLibrary(libId) {
        const lib = this.state.libraries.find(l => l.id === libId);
        if(!lib) return;
        
        // Find titles in this library. Clean private data (notes, ratings, personal dates) for sharing.
        const libMedia = this.state.media.filter(m => m.libraries.includes(libId)).map(m => ({
            tmdbId: m.tmdbId,
            type: m.type,
            title: m.title,
            posterPath: m.posterPath,
            releaseDate: m.releaseDate
        }));

        const exportData = {
            version: 1,
            type: 'shared_library',
            library: { name: lib.name, desc: lib.desc, icon: lib.icon, color: lib.color },
            titles: libMedia
        };

        if (navigator.share && /mobile/i.test(navigator.userAgent)) {
            const file = new File([JSON.stringify(exportData)], `${lib.name.replace(/\s+/g,'_')}.json`, {type: 'application/json'});
            navigator.share({ title: `Shared Library: ${lib.name}`, files: [file] }).catch(() => this.downloadJSON(exportData, `${lib.name.replace(/\s+/g,'_')}.json`));
        } else {
            this.downloadJSON(exportData, `${lib.name.replace(/\s+/g,'_')}.json`);
        }
    },

    handleImport(event, mode) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if(mode === 'backup') {
                    if(data.type !== 'full_backup') throw new Error("Invalid backup file.");
                    if(confirm("This will overwrite your existing collections. Continue?")) {
                        await this.restoreBackup(data);
                    }
                } else if(mode === 'library') {
                    if(data.type !== 'shared_library') throw new Error("Invalid library file.");
                    this.pendingImportData = data;
                    this.showLibraryImportPreview(data);
                }
            } catch (err) {
                alert("Error reading JSON file. It might be corrupted or in the wrong format.");
            }
            event.target.value = ''; // reset
        };
        reader.readAsText(file);
    },

    async restoreBackup(data) {
        await this.idbDelete('libraries');
        await this.idbDelete('media');
        await this.idbDelete('reminders');
        
        for(let l of data.libraries || []) await this.idbPut('libraries', l);
        for(let m of data.media || []) await this.idbPut('media', m);
        for(let r of data.reminders || []) await this.idbPut('reminders', r);
        
        await this.loadData();
        this.renderSidebarLibraries();
        this.navigate('#home');
        this.showToast('Backup restored successfully.');
    },

    showLibraryImportPreview(data) {
        const lib = data.library;
        document.getElementById('import-icon').textContent = lib.icon;
        document.getElementById('import-name').textContent = lib.name;
        document.getElementById('import-desc').textContent = lib.desc || '';
        document.getElementById('import-count').textContent = (data.titles || []).length;
        
        const targetSelect = document.getElementById('import-merge-target');
        targetSelect.innerHTML = this.state.libraries.map(l => `<option value="${l.id}">${this.escapeHtml(l.name)}</option>`).join('');
        
        const strategy = document.getElementById('import-strategy');
        document.getElementById('import-merge-target-group').classList.toggle('hidden', strategy.value !== 'merge');
        
        strategy.onchange = (e) => {
            document.getElementById('import-merge-target-group').classList.toggle('hidden', e.target.value !== 'merge');
        };

        document.getElementById('modal-import').classList.remove('hidden');
    },

    async processLibraryImport() {
        const data = this.pendingImportData;
        const strategy = document.getElementById('import-strategy').value;
        let targetLibId;

        if (strategy === 'new') {
            targetLibId = 'lib_' + Date.now();
            const newLib = {
                id: targetLibId,
                name: data.library.name,
                desc: data.library.desc,
                icon: data.library.icon,
                color: data.library.color,
                createdAt: Date.now()
            };
            await this.idbPut('libraries', newLib);
            this.state.libraries.push(newLib);
        } else {
            targetLibId = document.getElementById('import-merge-target').value;
            if(!targetLibId) return alert("Please select a target library.");
        }

        let importCount = 0;
        for (let item of data.titles) {
            const localId = `${item.type}_${item.tmdbId}`;
            let existing = this.state.media.find(m => m.id === localId);
            
            if (existing) {
                if (!existing.libraries.includes(targetLibId)) {
                    existing.libraries.push(targetLibId);
                    await this.idbPut('media', existing);
                    importCount++;
                }
            } else {
                const newMedia = {
                    id: localId,
                    tmdbId: item.tmdbId,
                    type: item.type,
                    title: item.title,
                    posterPath: item.posterPath,
                    backdropPath: null, // Minimal info from import
                    releaseDate: item.releaseDate,
                    status: null,
                    libraries: [targetLibId],
                    addedAt: Date.now()
                };
                await this.idbPut('media', newMedia);
                this.state.media.push(newMedia);
                importCount++;
            }
        }

        document.getElementById('modal-import').classList.add('hidden');
        this.renderSidebarLibraries();
        this.showToast(`Imported ${importCount} new titles to library.`);
        this.navigate(`#library_${targetLibId}`);
    },

    // --- Utils ---
    showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    escapeHtml(unsafe) {
        if(!unsafe) return '';
        return unsafe
             .toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
};

// Init PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(console.error);
    });
}

document.addEventListener('DOMContentLoaded', () => App.init());

function stockApp() {
    return {
        isAuthenticated: false,
        authChecking: true,
        currentRole: 'readonly',
        currentUsername: '',
        filterCat: 'all',

        loginForm: { username: '', password: '' },
        loginError: '',

        formInward: { itemId: '', qty: '' },
        formOutward: { itemId: '', department: 'Indian', qty: '' },
        formNote: { itemName: '', pax: '', dateLabel: '' },

        showNewItemModal: false,
        newItemForm: { name: '', categoryId: '', newCategoryName: '', threshold: 0 },

        showAccountModal: false,
        accountForm: { currentPassword: '', newPassword: '' },
        accountError: '',
        accountSuccess: '',

        showUserAdminModal: false,
        users: [],
        newUserForm: { username: '', password: '', role: 'inward' },
        newUserError: '',

        departments: ['Chinese', 'Indian', 'South Indian', 'Gujarati', 'Continental', 'Tandoor'],

        categories: [],
        items: [],
        importantNotes: [],
        logs: [],

        async init() {
            try {
                const res = await fetch('/api/auth/me');
                if (res.ok) {
                    const me = await res.json();
                    this.currentUsername = me.username;
                    this.currentRole = me.role;
                    this.isAuthenticated = true;
                    await this.loadAll();
                }
            } finally {
                this.authChecking = false;
            }
        },

        async loadAll() {
            await Promise.all([
                this.loadCategories(),
                this.loadItems(),
                this.loadNotes(),
                this.loadLogs(),
            ]);
            if (this.currentRole === 'admin') {
                await this.loadUsers();
            }
        },

        async api(url, options = {}) {
            const res = await fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            });
            if (!res.ok) {
                let message = 'Request failed';
                try {
                    const body = await res.json();
                    message = body.error || message;
                } catch (e) {}
                throw new Error(message);
            }
            if (res.status === 204) return null;
            const text = await res.text();
            return text ? JSON.parse(text) : null;
        },

        get processedItems() {
            let dataset = [...this.items];
            if (this.filterCat !== 'all') {
                dataset = dataset.filter((i) => i.category_name === this.filterCat);
            }
            return dataset.sort((a, b) => {
                let aAlert = a.stock <= a.threshold ? 1 : 0;
                let bAlert = b.stock <= b.threshold ? 1 : 0;
                if (aAlert !== bAlert) return bAlert - aAlert;
                return a.order_index - b.order_index;
            });
        },

        async verifyLogin() {
            this.loginError = '';
            try {
                const me = await this.api('/api/auth/login', {
                    method: 'POST',
                    body: JSON.stringify(this.loginForm),
                });
                this.currentUsername = me.username;
                this.currentRole = me.role;
                this.isAuthenticated = true;
                this.loginForm.password = '';
                await this.loadAll();
            } catch (err) {
                this.loginError = err.message;
            }
        },

        async logout() {
            await this.api('/api/auth/logout', { method: 'POST' });
            this.isAuthenticated = false;
            this.currentRole = 'readonly';
            this.currentUsername = '';
            location.reload();
        },

        async loadCategories() {
            this.categories = await this.api('/api/categories');
        },

        async loadItems() {
            this.items = await this.api('/api/items');
        },

        async loadNotes() {
            this.importantNotes = await this.api('/api/notes');
        },

        async loadLogs() {
            this.logs = await this.api('/api/logs');
        },

        async loadUsers() {
            this.users = await this.api('/api/auth/users');
        },

        isWithinOneHour(timestamp) {
            return timestamp ? Date.now() - new Date(timestamp).getTime() < 60 * 60 * 1000 : false;
        },

        async submitNewNote() {
            if (!this.formNote.itemName || !this.formNote.pax || !this.formNote.dateLabel) {
                return alert('Please fill out all Note fields completely.');
            }
            try {
                await this.api('/api/notes', { method: 'POST', body: JSON.stringify(this.formNote) });
                this.formNote = { itemName: '', pax: '', dateLabel: '' };
                await this.loadNotes();
            } catch (err) {
                alert(err.message);
            }
        },

        async deleteNote(noteId) {
            if (!confirm('Are you sure you want to remove this event note from the display panel?')) return;
            try {
                await this.api(`/api/notes/${noteId}`, { method: 'DELETE' });
                await this.loadNotes();
            } catch (err) {
                alert(err.message);
            }
        },

        async changeItemName(item) {
            let updatedName = prompt(`Enter new label for "${item.name}":`, item.name);
            if (updatedName && updatedName.trim() !== '') {
                try {
                    await this.api(`/api/items/${item.id}/rename`, { method: 'PATCH', body: JSON.stringify({ name: updatedName.trim() }) });
                    await this.loadItems();
                } catch (err) {
                    alert(err.message);
                }
            }
        },

        async modifyThreshold(item) {
            let promptVal = prompt(`Update low alert threshold limit for ${item.name}:`, item.threshold);
            if (promptVal !== null) {
                try {
                    await this.api(`/api/items/${item.id}/threshold`, { method: 'PATCH', body: JSON.stringify({ threshold: parseInt(promptVal) || 0 }) });
                    await this.loadItems();
                } catch (err) {
                    alert(err.message);
                }
            }
        },

        async purgeItem(id) {
            if (!confirm('Completely remove this item line entry?')) return;
            try {
                await this.api(`/api/items/${id}`, { method: 'DELETE' });
                await this.loadItems();
            } catch (err) {
                alert(err.message);
            }
        },

        async shiftOrder(id, direction) {
            try {
                await this.api(`/api/items/${id}/order`, { method: 'PATCH', body: JSON.stringify({ direction }) });
                await this.loadItems();
            } catch (err) {
                alert(err.message);
            }
        },

        async submitNewItem() {
            if (!this.newItemForm.name.trim()) return alert('Item name is required.');
            try {
                let categoryId = this.newItemForm.categoryId;
                if (!categoryId && this.newItemForm.newCategoryName.trim()) {
                    const newCat = await this.api('/api/categories', {
                        method: 'POST',
                        body: JSON.stringify({ name: this.newItemForm.newCategoryName.trim() }),
                    });
                    categoryId = newCat.id;
                }
                if (!categoryId) return alert('Select an existing category or enter a new category name.');
                await this.api('/api/items', {
                    method: 'POST',
                    body: JSON.stringify({ name: this.newItemForm.name.trim(), categoryId, threshold: this.newItemForm.threshold || 0 }),
                });
                this.newItemForm = { name: '', categoryId: '', newCategoryName: '', threshold: 0 };
                this.showNewItemModal = false;
                await Promise.all([this.loadItems(), this.loadCategories()]);
            } catch (err) {
                alert(err.message);
            }
        },

        async handleCsvUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const lines = text.split('\n');
                const rows = [];
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    const columns = lines[i].split(',');
                    if (columns.length >= 4) {
                        rows.push({
                            name: columns[0].trim(),
                            category: columns[1].trim(),
                            qty: parseInt(columns[2]) || 0,
                            threshold: parseInt(columns[3]) || 0,
                        });
                    }
                }
                try {
                    const result = await this.api('/api/items/csv-upload', { method: 'POST', body: JSON.stringify({ rows }) });
                    alert(`CSV Ingested lines parsed: ${result.addedCount}`);
                    await Promise.all([this.loadItems(), this.loadCategories()]);
                } catch (err) {
                    alert(err.message);
                }
                event.target.value = '';
            };
            reader.readAsText(file);
        },

        async addInward() {
            if (!this.formInward.itemId || !this.formInward.qty) return alert('Select missing fields.');
            try {
                await this.api('/api/items/inward', { method: 'POST', body: JSON.stringify(this.formInward) });
                this.formInward = { itemId: '', qty: '' };
                await Promise.all([this.loadItems(), this.loadLogs()]);
            } catch (err) {
                alert(err.message);
            }
        },

        async deductOutward() {
            if (!this.formOutward.itemId || !this.formOutward.qty) return alert('Select missing fields.');
            try {
                await this.api('/api/items/outward', { method: 'POST', body: JSON.stringify(this.formOutward) });
                this.formOutward = { itemId: '', department: 'Indian', qty: '' };
                await Promise.all([this.loadItems(), this.loadLogs()]);
            } catch (err) {
                alert(err.message);
            }
        },

        async triggerUndo(log) {
            try {
                await this.api(`/api/logs/${log.id}/undo`, { method: 'POST' });
                await Promise.all([this.loadItems(), this.loadLogs()]);
                alert('Action reversed successfully.');
            } catch (err) {
                alert(err.message);
            }
        },

        async changeMyPassword() {
            this.accountError = '';
            this.accountSuccess = '';
            try {
                await this.api('/api/auth/me/password', {
                    method: 'PATCH',
                    body: JSON.stringify(this.accountForm),
                });
                this.accountSuccess = 'Password updated successfully.';
                this.accountForm = { currentPassword: '', newPassword: '' };
            } catch (err) {
                this.accountError = err.message;
            }
        },

        async createUser() {
            this.newUserError = '';
            try {
                await this.api('/api/auth/users', { method: 'POST', body: JSON.stringify(this.newUserForm) });
                this.newUserForm = { username: '', password: '', role: 'inward' };
                await this.loadUsers();
            } catch (err) {
                this.newUserError = err.message;
            }
        },

        async changeUserRole(userId, role) {
            try {
                await this.api(`/api/auth/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
                await this.loadUsers();
            } catch (err) {
                alert(err.message);
                await this.loadUsers();
            }
        },

        async promptResetPassword(user) {
            const newPassword = prompt(`Set a new password for "${user.username}" (6+ characters):`);
            if (!newPassword) return;
            try {
                await this.api(`/api/auth/users/${user.id}/password`, { method: 'PATCH', body: JSON.stringify({ password: newPassword }) });
                alert('Password updated.');
            } catch (err) {
                alert(err.message);
            }
        },

        async deleteUser(userId) {
            if (!confirm('Delete this user account permanently?')) return;
            try {
                await this.api(`/api/auth/users/${userId}`, { method: 'DELETE' });
                await this.loadUsers();
            } catch (err) {
                alert(err.message);
            }
        },

        async downloadExcelReport() {
            const data = await this.api('/api/export');
            const today = new Date();
            const todayLabel = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', '');

            const matrixData = [['ITEM NAME', 'CATEGORY', 'CURRENT STOCK', 'TOTAL INWARD', 'TOTAL OUTWARD (BY DEPT)']];

            data.items.forEach((item) => {
                const itemLogs = data.logs.filter((l) => l.item_id === item.id);
                const totalIn = itemLogs.filter((l) => l.type === 'INWARD').reduce((acc, l) => acc + l.qty, 0);
                const outLogs = itemLogs.filter((l) => l.type === 'OUTWARD');
                const outSummary = outLogs.length
                    ? outLogs.map((l) => `-${l.qty} (${l.department})`).join('\r\n')
                    : '0';
                matrixData.push([item.name, item.category_name, item.stock, totalIn ? `+${totalIn}` : '0', outSummary]);
            });

            const ws = XLSX.utils.aoa_to_sheet(matrixData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Stock Ledger');
            ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
            XLSX.writeFile(wb, `Restaurant_Inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
        },
    };
}

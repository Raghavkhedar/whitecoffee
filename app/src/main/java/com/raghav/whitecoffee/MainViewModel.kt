package com.raghav.whitecoffee

import androidx.lifecycle.ViewModel
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.raghav.whitecoffee.data.repository.AuthRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _sessionInvalidated = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionInvalidated: SharedFlow<Unit> = _sessionInvalidated.asSharedFlow()

    private var listenerRegistration: ListenerRegistration? = null

    /**
     * Call on app startup (handles the "already logged in / process killed" case).
     * Restores session from cache if needed, then starts the monitor.
     */
    fun startMonitorIfLoggedIn() {
        if (authRepository.isLoggedIn()) startMonitor()
    }

    /**
     * Call right after a successful login to start monitoring.
     */
    fun onLoginSuccess() = startMonitor()

    private fun startMonitor() {
        val uid        = sessionManager.userId
        val localToken = sessionManager.sessionToken
        if (uid.isEmpty() || localToken.isEmpty()) return
        if (listenerRegistration != null) return  // already monitoring

        listenerRegistration = firestore.collection("users").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                val firestoreToken = snapshot.getString("activeSessionToken") ?: return@addSnapshotListener
                if (firestoreToken.isNotEmpty() && firestoreToken != localToken) {
                    _sessionInvalidated.tryEmit(Unit)
                }
            }
    }

    fun logout() {
        listenerRegistration?.remove()
        listenerRegistration = null
        authRepository.logout()
    }

    override fun onCleared() {
        listenerRegistration?.remove()
    }
}

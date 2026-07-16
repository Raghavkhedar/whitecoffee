package com.raghav.whitecoffee.data.firestore

import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** Firebase-agnostic handle so the primitive can be unit-tested without the SDK. */
fun interface Cancelable { fun cancel() }

/**
 * Turns any push-based subscribe/cancel API into a cold Flow. The [subscribe] lambda receives
 * an onNext + onError sink and returns a [Cancelable]; the flow removes the subscription when
 * the collector stops (screen left, ViewModel cleared). This is the only listener-wrapping
 * primitive in the app — the Firestore extensions below are one-liners over it.
 */
fun <T> listenerFlow(
    subscribe: (onNext: (T) -> Unit, onError: (Throwable) -> Unit) -> Cancelable
): Flow<T> = callbackFlow {
    val handle = subscribe({ trySend(it) }, { close(it) })
    awaitClose { handle.cancel() }
}

fun Query.snapshotsAsFlow(): Flow<QuerySnapshot> = listenerFlow { onNext, onError ->
    val reg = addSnapshotListener { snap, err ->
        if (err != null) onError(err) else if (snap != null) onNext(snap)
    }
    Cancelable { reg.remove() }
}

fun DocumentReference.snapshotsAsFlow(): Flow<DocumentSnapshot> = listenerFlow { onNext, onError ->
    val reg = addSnapshotListener { snap, err ->
        if (err != null) onError(err) else if (snap != null) onNext(snap)
    }
    Cancelable { reg.remove() }
}

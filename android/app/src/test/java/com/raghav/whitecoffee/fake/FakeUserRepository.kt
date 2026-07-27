package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.AccountSnapshot
import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.repository.UserRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * In-memory [UserRepository]. The real one needs a Context and a live Firestore handle.
 *
 * [accountUpdates] is driven by the test rather than by a snapshot listener, which is the whole
 * point of the contract: the account monitor's decisions (suspension overlay, single-device
 * ejection) can now be exercised without the Firebase SDK.
 */
class FakeUserRepository(
    var profile: User = User(
        id = "u1", name = "Test User", email = "test@whitecoffee.com",
        role = "operations", employeeId = "EMP001"
    )
) : UserRepository {

    /** Push an [AccountSnapshot] here to simulate a server-side change to the user doc. */
    val accountUpdates = MutableSharedFlow<AccountSnapshot>(extraBufferCapacity = 8)

    /** Every userId that [observeAccount] was asked to watch, in call order. */
    val observedUserIds = mutableListOf<String>()

    override fun observeAccount(userId: String): Flow<AccountSnapshot> {
        observedUserIds += userId
        return accountUpdates
    }

    /** Convenience for the common case: an active account holding [token]. */
    suspend fun emitActive(token: String) =
        accountUpdates.emit(AccountSnapshot(AccountStatus.Active, token))

    suspend fun emitSuspended(reason: String = "", expectedReturn: String = "", token: String = "") =
        accountUpdates.emit(
            AccountSnapshot(AccountStatus.Suspended(reason, expectedReturn), token)
        )

    override fun getCurrentUser(): User = profile

    override suspend fun getUserById(userId: String): Result<User> =
        if (userId == profile.id) Result.success(profile)
        else Result.failure(Exception("User not found."))

    override suspend fun getAllUsers(): Result<List<User>> = Result.success(listOf(profile))

    override suspend fun createUser(
        email: String,
        password: String,
        name: String,
        role: String,
        employeeId: String
    ): Result<String> = Result.success("new-uid")

    override suspend fun updateUserProfile(
        userId: String,
        name: String,
        role: String,
        employeeId: String
    ): Result<Unit> = Result.success(Unit)

    override suspend fun sendPasswordResetEmail(email: String): Result<Unit> = Result.success(Unit)
}

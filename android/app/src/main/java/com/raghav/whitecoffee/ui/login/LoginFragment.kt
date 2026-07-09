package com.raghav.whitecoffee.ui.login

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.fragment.app.viewModels
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.fragment.findNavController
import com.raghav.whitecoffee.MainViewModel
import com.raghav.whitecoffee.R
import com.raghav.whitecoffee.core.UiState
import dagger.hilt.android.AndroidEntryPoint

/**
 * Login screen — first screen migrated to Jetpack Compose.
 *
 * The Fragment is now a thin host: it owns the ViewModel + navigation and hands the UI to the
 * [LoginScreen] composable. No ViewBinding / XML inflation any more (fragment_login.xml is left in
 * place but unused). Everything else in the app still uses Views — this is the Compose interop
 * pilot, converting one screen without touching the others.
 */
@AndroidEntryPoint
class LoginFragment : Fragment() {

    private val viewModel: LoginViewModel by viewModels()
    private val mainViewModel: MainViewModel by activityViewModels()

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        // Tie the composition to the fragment's view lifecycle (same discipline as ViewBinding).
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            val state by viewModel.loginState.collectAsStateWithLifecycle()

            // Navigate once the ViewModel reports a successful login.
            LaunchedEffect(state) {
                if (state is UiState.Success) navigateToHome()
            }

            LoginScreen(
                uiState = state,
                onLogin = viewModel::login
            )
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        // If already logged in, skip straight to Home.
        if (viewModel.isAlreadyLoggedIn()) navigateToHome()
    }

    private fun navigateToHome() {
        val nav = findNavController()
        // Guard against a double-navigate (e.g. effect + already-logged-in both firing).
        if (nav.currentDestination?.id == R.id.loginFragment) {
            mainViewModel.onLoginSuccess()
            nav.navigate(R.id.action_loginFragment_to_homeFragment)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        viewModel.resetState()
    }
}

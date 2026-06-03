package com.raghav.whitecoffee.core

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.viewbinding.ViewBinding

/**
 * Base class for all Fragments in WhiteCoffee.
 *
 * Enforces the ViewBinding lifecycle contract:
 * - _binding is set in onCreateView
 * - _binding is cleared in onDestroyView (prevents memory leaks)
 * - binding (non-null) is only safe to use between onViewCreated and onDestroyView
 */
abstract class BaseFragment<VB : ViewBinding> : Fragment() {

    private var _binding: VB? = null

    /**
     * Non-null binding accessor. Only call this between onViewCreated
     * and onDestroyView. Throws immediately if misused outside that window.
     */
    protected val binding: VB
        get() = _binding ?: error(
            "Binding accessed outside of view lifecycle in ${javaClass.simpleName}. " +
                    "Do not access binding before onViewCreated or after onDestroyView."
        )

    /**
     * Subclasses provide their ViewBinding inflation here.
     * Example: return FragmentLoginBinding.inflate(inflater, container, false)
     */
    abstract fun inflateBinding(inflater: LayoutInflater, container: ViewGroup?): VB

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = inflateBinding(inflater, container)
        return binding.root
    }

    /**
     * All UI setup goes in onViewCreated — binding is guaranteed non-null here.
     */
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
    }

    override fun onDestroyView() {
        super.onDestroyView()
        // Critical: clear the binding reference to prevent memory leaks.
        // The Fragment outlives its View — holding a View reference here
        // would leak the entire view hierarchy.
        _binding = null
    }
}
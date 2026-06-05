package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.repository.RequestRepository
import com.raghav.whitecoffee.data.repository.SiteRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WorkProgressViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val siteRepository: SiteRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val _sitesState = MutableStateFlow<UiState<List<Site>>>(UiState.Loading)
    val sitesState: StateFlow<UiState<List<Site>>> = _sitesState.asStateFlow()

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    init {
        loadSites()
    }

    private fun loadSites() {
        viewModelScope.launch {
            _sitesState.value = UiState.Loading
            val result = siteRepository.getTodayAssignedSites()
            _sitesState.value = when {
                result.isSuccess -> {
                    val sites = result.getOrThrow()
                    if (sites.isEmpty()) UiState.Empty else UiState.Success(sites)
                }
                else -> UiState.Error("Failed to load sites.")
            }
        }
    }

    fun submitProgress(
        site: Site,
        date: String,
        hoursWorked: Double,
        workDescription: String,
        photoUris: List<Uri> = emptyList()
    ) {
        if (workDescription.isBlank()) {
            _submitState.value = UiState.Error("Please enter a work description.")
            return
        }
        if (hoursWorked <= 0.0) {
            _submitState.value = UiState.Error("Please enter valid hours worked.")
            return
        }

        _submitState.value = UiState.Loading
        viewModelScope.launch {
            val progress = WorkProgress(
                siteId          = site.id,
                siteName        = site.name,
                date            = date,
                hoursWorked     = hoursWorked,
                workDescription = workDescription.trim()
            )
            val result = requestRepository.submitWorkProgress(progress)
            if (result.isFailure) {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
                return@launch
            }
            val docId = result.getOrThrow()
            if (photoUris.isNotEmpty()) {
                val uploadResult = photoUploadManager.uploadPhotos(
                    photoUris, "work_progress", docId
                )
                if (uploadResult.isSuccess) {
                    requestRepository.updatePhotoUrls(
                        "work_progress", docId, uploadResult.getOrThrow()
                    )
                }
            }
            _submitState.value = UiState.Success(docId)
        }
    }

    fun resetSubmitState() {
        _submitState.value = UiState.Empty
    }
}

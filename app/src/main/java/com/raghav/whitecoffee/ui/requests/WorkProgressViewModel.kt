package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// SiteRepository + SiteTask removed — site is now entered as free text by the user.
// To re-enable: add SiteRepository injection, restore _sitesState + loadSites(),
// change submitProgress() back to accept SiteTask.

@HiltViewModel
class WorkProgressViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    fun submitProgress(
        siteId: String,
        siteName: String,
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
                siteId          = siteId.trim(),
                siteName        = siteName.trim(),
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

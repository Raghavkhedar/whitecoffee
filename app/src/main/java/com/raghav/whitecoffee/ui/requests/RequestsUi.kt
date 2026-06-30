package com.raghav.whitecoffee.ui.requests

import android.content.Context
import android.net.Uri
import android.widget.ImageView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import com.bumptech.glide.Glide
import com.raghav.whitecoffee.ui.theme.Ms
import com.raghav.whitecoffee.ui.theme.MsIcon
import com.raghav.whitecoffee.ui.theme.WcColors
import java.io.File

/** Top bar + offline banner + scrollable padded body for the request/transfer/work forms. */
@Composable
fun RequestScaffold(
    title: String,
    onBack: () -> Unit,
    isOnline: Boolean,
    body: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().background(WcColors.ScreenBg).verticalScroll(rememberScrollState()),
    ) {
        if (!isOnline) {
            Box(Modifier.fillMaxWidth().background(Color(0xFF78350F)).padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                Text("No internet connection", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 48.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(42.dp).clip(CircleShape).clickable { onBack() }, contentAlignment = Alignment.Center) {
                MsIcon(Ms.arrow_back, 24.sp, Color(0xFF16201F))
            }
            Spacer(Modifier.width(6.dp))
            Text(title, color = WcColors.TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold)
        }
        Column(Modifier.padding(horizontal = 18.dp).padding(bottom = 32.dp)) { body() }
    }
}

/**
 * Wires up both photo sources (camera + gallery) and returns a single lambda the screens call as
 * `onAddPhoto`. Tapping it shows a chooser; the chosen URIs flow straight into [onPhotosAdded] —
 * captured shots are written via [FileProvider] so they share the same compress + upload path as
 * gallery picks. Drop-in replacement for the old `PickMultipleVisualMedia`-only launcher.
 */
@Composable
fun rememberPhotoAdder(onPhotosAdded: (List<Uri>) -> Unit): () -> Unit {
    val context = LocalContext.current
    var showChooser by remember { mutableStateOf(false) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }

    val gallery = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(10),
    ) { uris -> if (uris.isNotEmpty()) onPhotosAdded(uris) }

    val camera = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { success ->
        cameraUri?.let { if (success) onPhotosAdded(listOf(it)) }
        cameraUri = null
    }

    if (showChooser) {
        PhotoSourceDialog(
            onCamera = {
                showChooser = false
                val uri = createCameraImageUri(context)
                cameraUri = uri
                camera.launch(uri)
            },
            onGallery = {
                showChooser = false
                gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            onDismiss = { showChooser = false },
        )
    }
    return { showChooser = true }
}

/** Creates an empty file under cacheDir/camera and returns its FileProvider content:// URI. */
private fun createCameraImageUri(context: Context): Uri {
    val dir = File(context.cacheDir, "camera").apply { mkdirs() }
    val file = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

/** Bottom chooser: take a new photo with the camera, or pick existing ones from the gallery. */
@Composable
private fun PhotoSourceDialog(onCamera: () -> Unit, onGallery: () -> Unit, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
                .background(WcColors.Surface).padding(horizontal = 20.dp, vertical = 20.dp),
        ) {
            Text("Add photo", color = WcColors.TextPrimary, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(16.dp))
            PhotoSourceRow(Ms.photo_camera, "Take a photo", "Open the camera now", onCamera)
            Spacer(Modifier.height(10.dp))
            PhotoSourceRow(Ms.add, "Choose from gallery", "Pick existing photos", onGallery)
            Spacer(Modifier.height(14.dp))
            Box(
                modifier = Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(14.dp)).clickable { onDismiss() },
                contentAlignment = Alignment.Center,
            ) { Text("Cancel", color = WcColors.TextSecondary, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun PhotoSourceRow(icon: String, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
            .border(1.5.dp, WcColors.Border, RoundedCornerShape(16.dp)).clickable { onClick() }.padding(13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(WcColors.Accent),
            contentAlignment = Alignment.Center,
        ) { MsIcon(icon, 22.sp, WcColors.Primary) }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = WcColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, color = WcColors.TextMuted, fontSize = 12.5.sp)
        }
    }
}

/** Add-photo tile + Glide thumbnails with a remove badge. */
@Composable
fun PhotoStrip(uris: List<Uri>, onAdd: () -> Unit, onRemove: (Uri) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(
            modifier = Modifier.size(74.dp).clip(RoundedCornerShape(14.dp))
                .border(1.5.dp, WcColors.DashBorder, RoundedCornerShape(14.dp)).clickable { onAdd() },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            MsIcon(Ms.photo_camera, 22.sp, Color(0xFF6B7878))
            Text("Add", color = Color(0xFF6B7878), fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }
        uris.forEach { uri ->
            Box(Modifier.size(74.dp)) {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).background(Color(0xFFE4ECEC))) {
                    AndroidView(
                        factory = { ctx -> ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP } },
                        update = { iv -> Glide.with(iv).load(uri).centerCrop().into(iv) },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                Box(
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).size(20.dp).clip(CircleShape)
                        .background(Color(0xCC000000)).clickable { onRemove(uri) },
                    contentAlignment = Alignment.Center,
                ) { MsIcon(Ms.close, 14.sp, Color.White) }
            }
        }
    }
}

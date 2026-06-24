# White Coffee — Android UI Redesign Handoff
> **For Claude Code:** Apply every file change below in sequence. All changes work together as a system — do not apply partially. The HTML prototype at `White Coffee.html` is the visual reference.

---

## Overview

This redesign upgrades the White Coffee attendance app from flat blue (`#1A5FAF`) to a premium **Midnight Indigo** palette with gradient module icons, richer typography sizing, and polished card surfaces. Every existing view ID is preserved — only visual properties change. No Kotlin logic needs to change.

**Design Prototype:** Open `White Coffee.html` in the project for the exact target look.

---

## Design System Reference

| Token | Old Value | New Value | Usage |
|---|---|---|---|
| `primary_blue` | `#1A5FAF` | `#3B82F6` | Buttons, links, accent |
| `midnight` | — | `#05091A` | Header darkest stop |
| `deep` | — | `#0D1836` | Header mid stop |
| `navy` | — | `#1A2F72` | Header light stop |
| `violet` | — | `#7C3AED` | Secondary accent |
| `background` | `#F0F4F8` | `#ECEFFE` | All screen backgrounds |
| `text_primary` | `#0D1B2A` | `#050B20` | Headings |
| `text_secondary` | `#6B7E94` | `#3A4470` | Body text |
| `text_hint` | `#A8BBCC` | `#8591BD` | Hints, captions |
| `border` | `#C8D6E8` | `#E0E4F8` | Card borders |
| `accent_light` | `#EBF2FB` | `#EEF2FF` | Light accent fills |
| Card radius | 16dp | 20dp | All MaterialCardViews |
| Button radius | 12dp | 14dp | All buttons |

---

## Part 1 — Value Resources

### 1.1 `app/src/main/res/values/colors.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- ── Brand Gradient Stops ── -->
    <color name="midnight">#05091A</color>
    <color name="deep">#0D1836</color>
    <color name="navy">#1A2F72</color>

    <!-- ── Primary Accent ── -->
    <color name="primary_blue">#3B82F6</color>
    <color name="primary_blue_dark">#0D1836</color>
    <color name="primary_blue_light">#1A2F72</color>
    <color name="violet">#7C3AED</color>

    <!-- ── Backgrounds ── -->
    <color name="background">#ECEFFE</color>
    <color name="surface">#FFFFFF</color>
    <color name="input_background">#FAFBFF</color>

    <!-- ── Borders ── -->
    <color name="border">#E0E4F8</color>

    <!-- ── Text ── -->
    <color name="text_primary">#050B20</color>
    <color name="text_secondary">#3A4470</color>
    <color name="text_hint">#8591BD</color>
    <color name="text_on_primary">#FFFFFF</color>
    <color name="header_text_sub">#A0BEFF</color>

    <!-- ── Accent Light ── -->
    <color name="accent_light">#EEF2FF</color>

    <!-- ── Status ── -->
    <color name="status_pending">#D97706</color>
    <color name="status_approved">#059669</color>
    <color name="status_rejected">#E11D48</color>
    <color name="status_pending_bg">#FEF3C7</color>
    <color name="status_approved_bg">#D1FAE5</color>
    <color name="status_rejected_bg">#FFE4E6</color>
    <color name="status_pending_text">#92400E</color>
    <color name="status_approved_text">#065F46</color>
    <color name="status_rejected_text">#9F1239</color>

    <!-- ── Module Icon Gradients ── -->
    <color name="mod_attendance_start">#1E3A8A</color>
    <color name="mod_attendance_end">#3B82F6</color>
    <color name="mod_mt_request_start">#9A3412</color>
    <color name="mod_mt_request_end">#F97316</color>
    <color name="mod_mt_buy_start">#064E3B</color>
    <color name="mod_mt_buy_end">#10B981</color>
    <color name="mod_mat_transfer_start">#4C1D95</color>
    <color name="mod_mat_transfer_end">#8B5CF6</color>
    <color name="mod_tool_transfer_start">#164E63</color>
    <color name="mod_tool_transfer_end">#06B6D4</color>
    <color name="mod_work_progress_start">#78350F</color>
    <color name="mod_work_progress_end">#FBBF24</color>
    <color name="mod_leave_start">#881337</color>
    <color name="mod_leave_end">#F43F5E</color>
    <color name="mod_leave_approval_start">#064E3B</color>
    <color name="mod_leave_approval_end">#34D399</color>

    <!-- ── Utility ── -->
    <color name="white">#FFFFFF</color>
    <color name="black">#000000</color>
    <color name="transparent">#00000000</color>
    <color name="ripple_primary">#1A3B82F6</color>
    <color name="divider">#EEF0FF</color>

</resources>
```

---

### 1.2 `app/src/main/res/values/themes.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>

    <style name="Theme.WhiteCoffee" parent="Theme.MaterialComponents.Light.NoActionBar">

        <item name="colorPrimary">@color/primary_blue</item>
        <item name="colorPrimaryDark">@color/midnight</item>
        <item name="colorPrimaryVariant">@color/navy</item>
        <item name="colorOnPrimary">@color/white</item>
        <item name="colorSecondary">@color/violet</item>
        <item name="colorSecondaryVariant">@color/navy</item>
        <item name="colorOnSecondary">@color/white</item>
        <item name="android:colorBackground">@color/background</item>
        <item name="colorSurface">@color/surface</item>
        <item name="colorOnSurface">@color/text_primary</item>
        <item name="colorOnBackground">@color/text_primary</item>
        <item name="android:statusBarColor">@color/midnight</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="materialCardViewStyle">@style/WC.CardView</item>
        <item name="materialButtonStyle">@style/WC.Button.Primary</item>
        <item name="textInputStyle">@style/WC.TextInputLayout</item>

    </style>

    <!-- ── Buttons ──────────────────────────────────────────────────── -->

    <style name="WC.Button.Primary" parent="Widget.MaterialComponents.Button">
        <item name="android:background">@drawable/bg_primary_button</item>
        <item name="backgroundTint">@null</item>
        <item name="android:textColor">@color/white</item>
        <item name="android:textSize">15sp</item>
        <item name="android:textStyle">bold</item>
        <item name="android:letterSpacing">-0.01</item>
        <item name="cornerRadius">14dp</item>
        <item name="android:paddingTop">15dp</item>
        <item name="android:paddingBottom">15dp</item>
        <item name="rippleColor">@color/ripple_primary</item>
        <item name="elevation">0dp</item>
        <item name="stateListAnimator">@null</item>
    </style>

    <style name="WC.Button.Outlined" parent="Widget.MaterialComponents.Button.OutlinedButton">
        <item name="strokeColor">@color/primary_blue</item>
        <item name="android:textColor">@color/primary_blue</item>
        <item name="android:textSize">15sp</item>
        <item name="cornerRadius">14dp</item>
        <item name="android:paddingTop">14dp</item>
        <item name="android:paddingBottom">14dp</item>
    </style>

    <style name="WC.Button.Danger" parent="Widget.MaterialComponents.Button.OutlinedButton">
        <item name="strokeColor">@color/status_rejected</item>
        <item name="android:textColor">@color/status_rejected</item>
        <item name="android:textSize">15sp</item>
        <item name="cornerRadius">14dp</item>
        <item name="android:paddingTop">14dp</item>
        <item name="android:paddingBottom">14dp</item>
    </style>

    <style name="WC.Button.Text" parent="Widget.MaterialComponents.Button.TextButton">
        <item name="android:textColor">@color/primary_blue</item>
        <item name="android:textSize">14sp</item>
    </style>

    <!-- ── Cards ────────────────────────────────────────────────────── -->

    <style name="WC.CardView" parent="Widget.MaterialComponents.CardView">
        <item name="cardBackgroundColor">@color/surface</item>
        <item name="cardCornerRadius">20dp</item>
        <item name="cardElevation">2dp</item>
        <item name="cardMaxElevation">4dp</item>
        <item name="strokeColor">@color/border</item>
        <item name="strokeWidth">1dp</item>
        <item name="contentPadding">16dp</item>
    </style>

    <style name="WC.CardView.NoPadding" parent="WC.CardView">
        <item name="contentPadding">0dp</item>
    </style>

    <style name="WC.CardView.Module" parent="WC.CardView">
        <item name="cardCornerRadius">18dp</item>
        <item name="contentPadding">0dp</item>
    </style>

    <!-- ── Inputs ────────────────────────────────────────────────────── -->

    <style name="WC.TextInputLayout" parent="Widget.MaterialComponents.TextInputLayout.OutlinedBox">
        <item name="boxStrokeColor">@color/wc_input_stroke</item>
        <item name="boxStrokeWidth">1.5dp</item>
        <item name="boxStrokeWidthFocused">1.5dp</item>
        <item name="boxBackgroundColor">@color/surface</item>
        <item name="hintTextColor">@color/wc_input_hint</item>
        <item name="android:textColorHint">@color/text_hint</item>
        <item name="boxCornerRadiusTopStart">12dp</item>
        <item name="boxCornerRadiusTopEnd">12dp</item>
        <item name="boxCornerRadiusBottomStart">12dp</item>
        <item name="boxCornerRadiusBottomEnd">12dp</item>
    </style>

    <style name="WC.TextInputEditText" parent="Widget.MaterialComponents.TextInputEditText.OutlinedBox">
        <item name="android:textColor">@color/text_primary</item>
        <item name="android:textSize">15sp</item>
        <item name="android:paddingTop">14dp</item>
        <item name="android:paddingBottom">14dp</item>
    </style>

    <!-- ── Typography ───────────────────────────────────────────────── -->

    <style name="WC.Text.ScreenTitle">
        <item name="android:textSize">20sp</item>
        <item name="android:textColor">@color/white</item>
        <item name="android:textStyle">bold</item>
        <item name="android:letterSpacing">-0.02</item>
    </style>

    <style name="WC.Text.SectionLabel">
        <item name="android:textSize">11sp</item>
        <item name="android:textColor">@color/text_hint</item>
        <item name="android:textAllCaps">true</item>
        <item name="android:letterSpacing">0.10</item>
        <item name="android:textStyle">bold</item>
    </style>

    <style name="WC.Text.Body">
        <item name="android:textSize">14sp</item>
        <item name="android:textColor">@color/text_primary</item>
        <item name="android:lineSpacingMultiplier">1.45</item>
    </style>

    <style name="WC.Text.Caption">
        <item name="android:textSize">12sp</item>
        <item name="android:textColor">@color/text_secondary</item>
    </style>

    <style name="WC.Text.HeaderGreeting">
        <item name="android:textSize">12sp</item>
        <item name="android:textColor">@color/header_text_sub</item>
    </style>

    <style name="WC.Text.HeaderName">
        <item name="android:textSize">22sp</item>
        <item name="android:textColor">@color/white</item>
        <item name="android:textStyle">bold</item>
        <item name="android:letterSpacing">-0.025</item>
    </style>

    <!-- ── FAB ──────────────────────────────────────────────────────── -->

    <style name="WC.ExtendedFab" parent="Widget.MaterialComponents.ExtendedFloatingActionButton">
        <item name="android:backgroundTint">@color/primary_blue</item>
        <item name="android:textColor">@color/white</item>
        <item name="iconTint">@color/white</item>
        <item name="cornerRadius">16dp</item>
        <item name="elevation">6dp</item>
    </style>

</resources>
```

---

## Part 2 — Color State Lists (NEW FILES)

### 2.1 `app/src/main/res/color/wc_input_stroke.xml` — CREATE

```xml
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:color="#3B82F6" android:state_focused="true"/>
    <item android:color="#E0E4F8"/>
</selector>
```

### 2.2 `app/src/main/res/color/wc_input_hint.xml` — CREATE

```xml
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:color="#3B82F6" android:state_focused="true"/>
    <item android:color="#8591BD"/>
</selector>
```

---

## Part 3 — Drawable Resources

### 3.1 `app/src/main/res/drawable/bg_header.xml` — REPLACE

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient
        android:type="linear"
        android:angle="150"
        android:startColor="#05091A"
        android:centerColor="#0D1836"
        android:endColor="#1A2F72"/>
</shape>
```

### 3.2 `app/src/main/res/drawable/bg_login.xml` — REPLACE

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="@color/background"/>
</shape>
```

*(The dark hero gradient is now a separate view inside the layout — see Part 4.1)*

### 3.3 `app/src/main/res/drawable/bg_primary_button.xml` — CREATE

```xml
<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <shape>
            <gradient android:type="linear" android:angle="0"
                android:startColor="#050B20" android:endColor="#2563EB"/>
            <corners android:radius="14dp"/>
        </shape>
    </item>
    <item android:state_enabled="false">
        <shape>
            <solid android:color="#C5CDEA"/>
            <corners android:radius="14dp"/>
        </shape>
    </item>
    <item>
        <shape>
            <gradient android:type="linear" android:angle="0"
                android:startColor="#0D1836" android:endColor="#3B82F6"/>
            <corners android:radius="14dp"/>
        </shape>
    </item>
</selector>
```

### 3.4 `app/src/main/res/drawable/bg_header_back_btn.xml` — CREATE

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#1AFFFFFF"/>
    <stroke android:width="1dp" android:color="#26FFFFFF"/>
    <corners android:radius="11dp"/>
</shape>
```

### 3.5 `app/src/main/res/drawable/bg_role_badge.xml` — CREATE

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#14FFFFFF"/>
    <stroke android:width="1dp" android:color="#24FFFFFF"/>
    <corners android:radius="20dp"/>
</shape>
```

### 3.6 Module Icon Gradients — CREATE ALL 8 FILES

**`app/src/main/res/drawable/bg_mod_attendance.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#1E3A8A" android:endColor="#3B82F6"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_mt_request.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#9A3412" android:endColor="#F97316"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_mt_buy.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#064E3B" android:endColor="#10B981"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_mat_transfer.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#4C1D95" android:endColor="#8B5CF6"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_tool_transfer.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#164E63" android:endColor="#06B6D4"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_work_progress.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#78350F" android:endColor="#FBBF24"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_leave.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#881337" android:endColor="#F43F5E"/>
    <corners android:radius="13dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_mod_leave_approval.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient android:type="linear" android:angle="135"
        android:startColor="#064E3B" android:endColor="#34D399"/>
    <corners android:radius="13dp"/>
</shape>
```

### 3.7 Status Badge Backgrounds — CREATE / UPDATE

**`app/src/main/res/drawable/badge_bg_pending.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="@color/status_pending_bg"/>
    <corners android:radius="20dp"/>
</shape>
```

**`app/src/main/res/drawable/badge_bg_approved.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="@color/status_approved_bg"/>
    <corners android:radius="20dp"/>
</shape>
```

**`app/src/main/res/drawable/badge_bg_rejected.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="@color/status_rejected_bg"/>
    <corners android:radius="20dp"/>
</shape>
```

### 3.8 Today Date Card — CREATE

**`app/src/main/res/drawable/bg_today_status_not_in.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#14F43F5E"/>
    <corners android:radius="20dp"/>
</shape>
```

**`app/src/main/res/drawable/bg_today_status_checked_in.xml`**
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#1410B981"/>
    <corners android:radius="20dp"/>
</shape>
```

---

## Part 4 — Fragment Layouts

### 4.1 `app/src/main/res/layout/fragment_login.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<ScrollView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background"
    android:fillViewport="true">

    <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content">

        <!-- ── Dark hero header ── -->
        <androidx.constraintlayout.widget.ConstraintLayout
            android:id="@+id/login_hero"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:background="@drawable/bg_header"
            android:paddingTop="72dp"
            android:paddingBottom="60dp"
            android:paddingHorizontal="28dp"
            app:layout_constraintTop_toTopOf="parent"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent">

            <!-- Logo card -->
            <androidx.cardview.widget.CardView
                android:id="@+id/logo_card"
                android:layout_width="84dp"
                android:layout_height="84dp"
                app:cardCornerRadius="26dp"
                app:cardElevation="0dp"
                app:cardBackgroundColor="#22FFFFFF"
                app:layout_constraintTop_toTopOf="parent"
                app:layout_constraintStart_toStartOf="parent"
                app:layout_constraintEnd_toEndOf="parent">

                <TextView
                    android:layout_width="match_parent"
                    android:layout_height="match_parent"
                    android:text="WC"
                    android:textColor="@color/white"
                    android:textSize="28sp"
                    android:textStyle="bold"
                    android:gravity="center"
                    android:letterSpacing="-0.02"/>

            </androidx.cardview.widget.CardView>

            <!-- App name -->
            <TextView
                android:id="@+id/tv_app_name"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="White Coffee"
                android:textSize="28sp"
                android:textStyle="bold"
                android:textColor="@color/white"
                android:letterSpacing="-0.03"
                android:layout_marginTop="20dp"
                app:layout_constraintTop_toBottomOf="@id/logo_card"
                app:layout_constraintStart_toStartOf="parent"
                app:layout_constraintEnd_toEndOf="parent"/>

            <!-- Subtitle -->
            <TextView
                android:id="@+id/tv_subtitle"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Senken Engineering · Field Operations"
                android:textSize="13sp"
                android:textColor="@color/header_text_sub"
                android:gravity="center"
                android:layout_marginTop="7dp"
                app:layout_constraintTop_toBottomOf="@id/tv_app_name"
                app:layout_constraintStart_toStartOf="parent"
                app:layout_constraintEnd_toEndOf="parent"/>

        </androidx.constraintlayout.widget.ConstraintLayout>

        <!-- ── Login form card (overlaps hero) ── -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/login_card"
            style="@style/WC.CardView"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginHorizontal="18dp"
            android:layout_marginTop="-24dp"
            app:layout_constraintTop_toBottomOf="@id/login_hero"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent">

            <androidx.constraintlayout.widget.ConstraintLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:padding="22dp">

                <TextView
                    android:id="@+id/tv_sign_in"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Welcome back"
                    android:textSize="20sp"
                    android:textStyle="bold"
                    android:textColor="@color/text_primary"
                    android:letterSpacing="-0.025"
                    app:layout_constraintTop_toTopOf="parent"
                    app:layout_constraintStart_toStartOf="parent"/>

                <TextView
                    android:id="@+id/tv_sign_in_sub"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Sign in with your company credentials"
                    android:textSize="13sp"
                    android:textColor="@color/text_hint"
                    android:layout_marginTop="4dp"
                    app:layout_constraintTop_toBottomOf="@id/tv_sign_in"
                    app:layout_constraintStart_toStartOf="parent"/>

                <!-- Email -->
                <com.google.android.material.textfield.TextInputLayout
                    android:id="@+id/til_email"
                    style="@style/WC.TextInputLayout"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="24dp"
                    android:hint="Email address"
                    app:startIconDrawable="@android:drawable/ic_dialog_email"
                    app:startIconTint="@color/text_hint"
                    app:layout_constraintTop_toBottomOf="@id/tv_sign_in_sub"
                    app:layout_constraintStart_toStartOf="parent"
                    app:layout_constraintEnd_toEndOf="parent">

                    <com.google.android.material.textfield.TextInputEditText
                        android:id="@+id/et_email"
                        style="@style/WC.TextInputEditText"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:inputType="textEmailAddress"
                        android:imeOptions="actionNext"
                        android:maxLines="1"/>

                </com.google.android.material.textfield.TextInputLayout>

                <!-- Password -->
                <com.google.android.material.textfield.TextInputLayout
                    android:id="@+id/til_password"
                    style="@style/WC.TextInputLayout"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="14dp"
                    android:hint="Password"
                    app:startIconDrawable="@android:drawable/ic_lock_lock"
                    app:startIconTint="@color/text_hint"
                    app:endIconMode="password_toggle"
                    app:layout_constraintTop_toBottomOf="@id/til_email"
                    app:layout_constraintStart_toStartOf="parent"
                    app:layout_constraintEnd_toEndOf="parent">

                    <com.google.android.material.textfield.TextInputEditText
                        android:id="@+id/et_password"
                        style="@style/WC.TextInputEditText"
                        android:layout_width="match_parent"
                        android:layout_height="wrap_content"
                        android:inputType="textPassword"
                        android:imeOptions="actionDone"
                        android:maxLines="1"/>

                </com.google.android.material.textfield.TextInputLayout>

                <!-- Error -->
                <TextView
                    android:id="@+id/tv_error"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="10dp"
                    android:textSize="13sp"
                    android:textColor="@color/status_rejected"
                    android:visibility="gone"
                    android:text=""
                    app:layout_constraintTop_toBottomOf="@id/til_password"
                    app:layout_constraintStart_toStartOf="parent"
                    app:layout_constraintEnd_toEndOf="parent"/>

                <!-- Login button -->
                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btn_login"
                    style="@style/WC.Button.Primary"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="20dp"
                    android:text="Sign In →"
                    app:layout_constraintTop_toBottomOf="@id/tv_error"
                    app:layout_constraintStart_toStartOf="parent"
                    app:layout_constraintEnd_toEndOf="parent"/>

                <!-- Progress -->
                <com.google.android.material.progressindicator.LinearProgressIndicator
                    android:id="@+id/progress_bar"
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="12dp"
                    android:visibility="gone"
                    app:indicatorColor="@color/primary_blue"
                    app:trackColor="@color/accent_light"
                    app:layout_constraintTop_toBottomOf="@id/btn_login"
                    app:layout_constraintStart_toStartOf="parent"
                    app:layout_constraintEnd_toEndOf="parent"/>

            </androidx.constraintlayout.widget.ConstraintLayout>

        </com.google.android.material.card.MaterialCardView>

        <!-- Footer -->
        <TextView
            android:id="@+id/tv_footer"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Senken Engineering © 2025"
            android:textSize="12sp"
            android:textColor="@color/text_hint"
            android:layout_marginTop="24dp"
            android:layout_marginBottom="32dp"
            app:layout_constraintTop_toBottomOf="@id/login_card"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"
            app:layout_constraintBottom_toBottomOf="parent"/>

    </androidx.constraintlayout.widget.ConstraintLayout>

</ScrollView>
```

---

### 4.2 `app/src/main/res/layout/fragment_notifications.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background">

    <include
        layout="@layout/view_offline_banner"
        android:id="@+id/offline_banner"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        app:layout_constraintTop_toTopOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent"/>

    <!-- Header -->
    <androidx.constraintlayout.widget.ConstraintLayout
        android:id="@+id/header"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_header"
        android:paddingHorizontal="16dp"
        android:paddingTop="52dp"
        android:paddingBottom="18dp"
        app:layout_constraintTop_toBottomOf="@id/offline_banner"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent">

        <ImageView
            android:id="@+id/btn_back"
            android:layout_width="38dp"
            android:layout_height="38dp"
            android:src="@android:drawable/ic_menu_revert"
            android:tint="@color/white"
            android:padding="9dp"
            android:background="@drawable/bg_header_back_btn"
            android:clickable="true"
            android:focusable="true"
            app:layout_constraintTop_toTopOf="parent"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintBottom_toBottomOf="parent"/>

        <TextView
            android:id="@+id/tv_title"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:text="Notifications"
            android:textSize="19sp"
            android:textStyle="bold"
            android:textColor="@color/white"
            android:letterSpacing="-0.02"
            android:layout_marginStart="12dp"
            app:layout_constraintTop_toTopOf="@id/btn_back"
            app:layout_constraintBottom_toBottomOf="@id/btn_back"
            app:layout_constraintStart_toEndOf="@id/btn_back"
            app:layout_constraintEnd_toEndOf="parent"/>

    </androidx.constraintlayout.widget.ConstraintLayout>

    <!-- Mark All Read -->
    <com.google.android.material.button.MaterialButton
        android:id="@+id/btn_mark_all_read"
        style="@style/WC.Button.Text"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Mark all as read"
        android:textColor="@color/primary_blue"
        android:textSize="13sp"
        android:visibility="gone"
        android:layout_marginEnd="12dp"
        android:layout_marginTop="4dp"
        app:layout_constraintTop_toBottomOf="@id/header"
        app:layout_constraintEnd_toEndOf="parent"/>

    <!-- Loading -->
    <ProgressBar
        android:id="@+id/progress_bar"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:visibility="gone"
        app:layout_constraintTop_toBottomOf="@id/btn_mark_all_read"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintBottom_toBottomOf="parent"/>

    <!-- Empty state -->
    <TextView
        android:id="@+id/tv_empty"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="No notifications yet"
        android:textColor="@color/text_secondary"
        android:textSize="15sp"
        android:visibility="gone"
        app:layout_constraintTop_toBottomOf="@id/btn_mark_all_read"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintBottom_toBottomOf="parent"/>

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btn_retry"
        style="@style/WC.Button.Text"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Retry"
        android:textColor="@color/primary_blue"
        android:visibility="gone"
        app:layout_constraintTop_toBottomOf="@id/tv_empty"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent"/>

    <!-- List -->
    <androidx.swiperefreshlayout.widget.SwipeRefreshLayout
        android:id="@+id/swipe_refresh"
        android:layout_width="0dp"
        android:layout_height="0dp"
        android:layout_marginTop="4dp"
        app:layout_constraintTop_toBottomOf="@id/btn_mark_all_read"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent">

        <androidx.recyclerview.widget.RecyclerView
            android:id="@+id/rv_notifications"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:padding="14dp"
            android:clipToPadding="false"/>

    </androidx.swiperefreshlayout.widget.SwipeRefreshLayout>

</androidx.constraintlayout.widget.ConstraintLayout>
```

---

### 4.3 `app/src/main/res/layout/fragment_leave.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background">

    <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent">

        <include
            layout="@layout/view_offline_banner"
            android:id="@+id/offline_banner"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            app:layout_constraintTop_toTopOf="parent"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"/>

        <!-- Header -->
        <androidx.constraintlayout.widget.ConstraintLayout
            android:id="@+id/header"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:background="@drawable/bg_header"
            android:paddingHorizontal="16dp"
            android:paddingTop="52dp"
            android:paddingBottom="20dp"
            app:layout_constraintTop_toBottomOf="@id/offline_banner"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent">

            <ImageView
                android:id="@+id/btn_back"
                android:layout_width="38dp"
                android:layout_height="38dp"
                android:src="@android:drawable/ic_menu_revert"
                android:tint="@color/white"
                android:padding="9dp"
                android:background="@drawable/bg_header_back_btn"
                android:clickable="true"
                android:focusable="true"
                app:layout_constraintTop_toTopOf="parent"
                app:layout_constraintStart_toStartOf="parent"/>

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:layout_marginStart="12dp"
                app:layout_constraintTop_toTopOf="@id/btn_back"
                app:layout_constraintBottom_toBottomOf="@id/btn_back"
                app:layout_constraintStart_toEndOf="@id/btn_back"
                app:layout_constraintEnd_toEndOf="parent">

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="My Leaves"
                    android:textSize="19sp"
                    android:textStyle="bold"
                    android:textColor="@color/white"
                    android:letterSpacing="-0.02"/>

                <TextView
                    android:id="@+id/tv_header_sub"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text=""
                    android:textSize="11sp"
                    android:textColor="@color/header_text_sub"
                    android:layout_marginTop="1dp"/>

            </LinearLayout>

        </androidx.constraintlayout.widget.ConstraintLayout>

        <!-- Loading -->
        <com.google.android.material.progressindicator.LinearProgressIndicator
            android:id="@+id/progress_bar"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:visibility="gone"
            app:indicatorColor="@color/primary_blue"
            app:trackColor="@color/accent_light"
            app:layout_constraintTop_toBottomOf="@id/header"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"/>

        <!-- List -->
        <androidx.swiperefreshlayout.widget.SwipeRefreshLayout
            android:id="@+id/swipe_refresh"
            android:layout_width="0dp"
            android:layout_height="0dp"
            app:layout_constraintTop_toBottomOf="@id/header"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"
            app:layout_constraintBottom_toBottomOf="parent">

            <androidx.recyclerview.widget.RecyclerView
                android:id="@+id/rv_leaves"
                android:layout_width="match_parent"
                android:layout_height="match_parent"
                android:padding="14dp"
                android:clipToPadding="false"/>

        </androidx.swiperefreshlayout.widget.SwipeRefreshLayout>

        <!-- Empty state -->
        <TextView
            android:id="@+id/tv_empty"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="No leave requests yet."
            android:textSize="15sp"
            android:textColor="@color/text_secondary"
            android:visibility="gone"
            app:layout_constraintTop_toBottomOf="@id/header"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"
            app:layout_constraintBottom_toBottomOf="parent"/>

        <com.google.android.material.button.MaterialButton
            android:id="@+id/btn_retry"
            style="@style/WC.Button.Text"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Retry"
            android:visibility="gone"
            app:layout_constraintTop_toBottomOf="@id/tv_empty"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintEnd_toEndOf="parent"/>

    </androidx.constraintlayout.widget.ConstraintLayout>

    <!-- FAB -->
    <com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
        android:id="@+id/fab_apply"
        style="@style/WC.ExtendedFab"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom|end"
        android:layout_margin="20dp"
        android:text="Apply for Leave"
        app:icon="@android:drawable/ic_input_add"
        android:backgroundTint="@color/primary_blue"
        android:textColor="@color/white"
        app:iconTint="@color/white"/>

</androidx.coordinatorlayout.widget.CoordinatorLayout>
```

---

### 4.4 `app/src/main/res/layout/fragment_home.xml` — TARGETED CHANGES

> Read the full file from the repo. Apply only these specific changes:

**Change 1 — Header background already correct** (`@drawable/bg_header` is now the new dark gradient ✓)

**Change 2 — Header text colors.** Find `android:textColor="#BBDEFB"` (the greeting text) and change to:
```xml
android:textColor="@color/header_text_sub"
```

**Change 3 — Role badge background.** Find `android:background="@drawable/badge_bg"` on `tv_role_badge` and change to:
```xml
android:background="@drawable/bg_role_badge"
android:textColor="@color/white"
android:paddingHorizontal="10dp"
android:paddingVertical="4dp"
```

**Change 4 — Add "Today" card below the header.** After the closing `</androidx.constraintlayout.widget.ConstraintLayout>` of the `@+id/header` view, insert:

```xml
<!-- ── Today Summary Card ── -->
<com.google.android.material.card.MaterialCardView
    android:id="@+id/card_today"
    style="@style/WC.CardView"
    android:layout_width="0dp"
    android:layout_height="wrap_content"
    android:layout_marginHorizontal="14dp"
    android:layout_marginTop="14dp"
    app:layout_constraintTop_toBottomOf="@id/header"
    app:layout_constraintStart_toStartOf="parent"
    app:layout_constraintEnd_toEndOf="parent">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="14dp"
        android:gravity="center_vertical">

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tv_today_day"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Wednesday"
                android:textSize="11sp"
                android:textColor="@color/text_hint"/>

            <TextView
                android:id="@+id/tv_today_date_num"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="18"
                android:textSize="28sp"
                android:textStyle="bold"
                android:textColor="@color/text_primary"
                android:letterSpacing="-0.04"
                android:lineSpacingMultiplier="1.0"/>

            <TextView
                android:id="@+id/tv_today_month"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="June 2025"
                android:textSize="12sp"
                android:textColor="@color/text_secondary"
                android:layout_marginTop="2dp"/>

        </LinearLayout>

        <!-- Divider -->
        <View
            android:layout_width="1dp"
            android:layout_height="44dp"
            android:background="@color/border"
            android:layout_marginHorizontal="14dp"/>

        <!-- Attendance status -->
        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:gravity="end">

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="Attendance"
                android:textSize="10sp"
                android:textColor="@color/text_hint"
                android:layout_marginBottom="5dp"/>

            <LinearLayout
                android:id="@+id/layout_today_status"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:orientation="horizontal"
                android:gravity="center_vertical"
                android:background="@drawable/bg_today_status_not_in"
                android:paddingHorizontal="10dp"
                android:paddingVertical="5dp">

                <View
                    android:layout_width="6dp"
                    android:layout_height="6dp"
                    android:background="@drawable/badge_red_bg"
                    android:layout_marginEnd="5dp"/>

                <TextView
                    android:id="@+id/tv_today_att_status"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="Not checked in"
                    android:textSize="11sp"
                    android:textStyle="bold"
                    android:textColor="@color/status_rejected"/>

            </LinearLayout>

        </LinearLayout>

    </LinearLayout>

</com.google.android.material.card.MaterialCardView>
```

**Change 5 — Module cards.** For each module card's icon ImageView (or icon container View), set its background drawable to the corresponding `bg_mod_*.xml`:
- Attendance → `@drawable/bg_mod_attendance`
- M&T Request → `@drawable/bg_mod_mt_request`
- M&T Buy → `@drawable/bg_mod_mt_buy`
- Material Transfer → `@drawable/bg_mod_mat_transfer`
- Tool Transfer → `@drawable/bg_mod_tool_transfer`
- Work Progress → `@drawable/bg_mod_work_progress`
- Leave → `@drawable/bg_mod_leave`
- Leave Approval → `@drawable/bg_mod_leave_approval`

Also set `android:imageTintList="@color/white"` on each icon ImageView.

**Change 6 — Section label.** Find any `TextView` used as a section label above the module grid and add:
```xml
style="@style/WC.Text.SectionLabel"
android:layout_marginBottom="10dp"
```

**Change 7 — Update constraint for `card_today`.** All elements that previously constrained their top to `@id/header` should now constrain to `@id/card_today`:
```
app:layout_constraintTop_toBottomOf="@id/card_today"
```
Except the header itself and card_today.

---

### 4.5 All Other Fragment Headers — TARGETED CHANGES (apply to all)

> Apply to: `fragment_attendance.xml`, `fragment_office_attendance.xml`, `fragment_material_tool_buy.xml`, `fragment_material_tool_request.xml`, `fragment_material_transfer.xml`, `fragment_tool_transfer.xml`, `fragment_work_progress.xml`, `fragment_apply_leave.xml`, `fragment_leave_approvals.xml`, `fragment_regularization.xml`

**For every back button (`btn_back`) ImageView in headers:**
```xml
android:background="@drawable/bg_header_back_btn"
android:padding="9dp"
android:layout_width="38dp"
android:layout_height="38dp"
```

**For every header title TextView:**
```xml
android:textSize="19sp"
android:letterSpacing="-0.02"
android:textStyle="bold"
```

**For every header subtitle TextView (date, sub-label):**
```xml
android:textColor="@color/header_text_sub"
```

**For every primary button (`WC.Button.Primary`):**
- The `bg_primary_button.xml` selector will handle the gradient automatically since `WC.Button.Primary` style now sets `android:background="@drawable/bg_primary_button"`.
- Ensure `android:layout_height="wrap_content"` and no conflicting `backgroundTint`.

**For every `MaterialCardView` with `style="@style/WC.CardView"`:**
- The updated style automatically applies: `cardCornerRadius="20dp"`, `cardElevation="2dp"`, `strokeColor="@color/border"`.

---

## Part 5 — Item Layouts

### 5.1 `app/src/main/res/layout/item_notification.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<com.google.android.material.card.MaterialCardView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    style="@style/WC.CardView.NoPadding"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="9dp"
    android:foreground="?attr/selectableItemBackground">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="14dp">

        <!-- Unread accent bar -->
        <View
            android:id="@+id/view_accent_bar"
            android:layout_width="3dp"
            android:layout_height="match_parent"
            android:background="@color/primary_blue"
            android:layout_marginEnd="12dp"
            android:visibility="gone"/>

        <!-- Content -->
        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:orientation="vertical">

            <TextView
                android:id="@+id/tv_notif_title"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:textSize="13sp"
                android:textStyle="bold"
                android:textColor="@color/text_primary"
                android:letterSpacing="-0.01"/>

            <TextView
                android:id="@+id/tv_notif_body"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:textSize="12sp"
                android:textColor="@color/text_secondary"
                android:layout_marginTop="4dp"
                android:lineSpacingMultiplier="1.45"/>

        </LinearLayout>

        <!-- Right column: time + unread dot -->
        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:gravity="end|top"
            android:layout_marginStart="8dp">

            <TextView
                android:id="@+id/tv_notif_time"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:textSize="10sp"
                android:textColor="@color/text_hint"/>

            <View
                android:id="@+id/dot_unread"
                android:layout_width="7dp"
                android:layout_height="7dp"
                android:background="@drawable/badge_red_bg"
                android:layout_marginTop="6dp"
                android:layout_gravity="end"
                android:visibility="gone"/>

        </LinearLayout>

    </LinearLayout>

</com.google.android.material.card.MaterialCardView>
```

### 5.2 `app/src/main/res/layout/item_leave_request.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<com.google.android.material.card.MaterialCardView
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    style="@style/WC.CardView.NoPadding"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="10dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:padding="15dp">

        <!-- Top row: type + status badge -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical"
            android:layout_marginBottom="6dp">

            <LinearLayout
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:orientation="vertical">

                <TextView
                    android:id="@+id/tv_leave_type"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:textSize="14sp"
                    android:textStyle="bold"
                    android:textColor="@color/text_primary"
                    android:letterSpacing="-0.01"/>

                <TextView
                    android:id="@+id/tv_dates"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:textSize="12sp"
                    android:textColor="@color/text_hint"
                    android:layout_marginTop="2dp"/>

            </LinearLayout>

            <TextView
                android:id="@+id/tv_status"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:textSize="11sp"
                android:textStyle="bold"
                android:paddingHorizontal="10dp"
                android:paddingVertical="4dp"
                android:background="@drawable/badge_bg"/>

        </LinearLayout>

        <!-- Reason + days chip -->
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <TextView
                android:id="@+id/tv_reason"
                android:layout_width="0dp"
                android:layout_height="wrap_content"
                android:layout_weight="1"
                android:textSize="12sp"
                android:textColor="@color/text_secondary"
                android:maxLines="2"
                android:ellipsize="end"
                android:lineSpacingMultiplier="1.45"
                android:paddingEnd="10dp"/>

            <TextView
                android:id="@+id/tv_submitted"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:textSize="11sp"
                android:textStyle="bold"
                android:textColor="@color/primary_blue"
                android:background="@color/accent_light"
                android:paddingHorizontal="9dp"
                android:paddingVertical="3dp"/>

        </LinearLayout>

        <!-- Approver comment (hidden by default) -->
        <TextView
            android:id="@+id/tv_approver_comment"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textSize="12sp"
            android:textColor="@color/status_rejected"
            android:layout_marginTop="6dp"
            android:visibility="gone"/>

    </LinearLayout>

</com.google.android.material.card.MaterialCardView>
```

### 5.3 `app/src/main/res/layout/item_attendance_event.xml` — REPLACE ENTIRE FILE

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:paddingVertical="10dp">

    <!-- Timeline column -->
    <LinearLayout
        android:layout_width="26dp"
        android:layout_height="match_parent"
        android:orientation="vertical"
        android:gravity="center_horizontal">

        <View
            android:id="@+id/timeline_dot"
            android:layout_width="12dp"
            android:layout_height="12dp"
            android:background="@drawable/timeline_dot"/>

        <View
            android:id="@+id/timeline_line"
            android:layout_width="2dp"
            android:layout_height="0dp"
            android:layout_weight="1"
            android:background="@color/border"
            android:layout_marginTop="3dp"/>

    </LinearLayout>

    <!-- Event content -->
    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical"
        android:paddingStart="12dp"
        android:paddingTop="1dp">

        <TextView
            android:id="@+id/tv_event_type"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textSize="13sp"
            android:textStyle="bold"
            android:textColor="@color/text_primary"
            android:letterSpacing="-0.01"/>

        <TextView
            android:id="@+id/tv_event_detail"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textSize="11sp"
            android:textColor="@color/text_hint"
            android:layout_marginTop="2dp"
            android:lineSpacingMultiplier="1.4"/>

    </LinearLayout>

</LinearLayout>
```

---

## Part 6 — Typography (Manual Step)

For the full Space Grotesk + DM Sans treatment:

1. Go to **Google Fonts** and download:
   - Space Grotesk (weights 600, 700) → save as `space_grotesk_semibold.ttf`, `space_grotesk_bold.ttf`
   - DM Sans (weights 400, 500) → save as `dm_sans_regular.ttf`, `dm_sans_medium.ttf`

2. Place all 4 `.ttf` files into `app/src/main/res/font/`

3. Create `app/src/main/res/font/wc_heading.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <font-family xmlns:android="http://schemas.android.com/apk/res/android">
       <font android:fontStyle="normal" android:fontWeight="600"
             android:font="@font/space_grotesk_semibold"/>
       <font android:fontStyle="normal" android:fontWeight="700"
             android:font="@font/space_grotesk_bold"/>
   </font-family>
   ```

4. Create `app/src/main/res/font/wc_body.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <font-family xmlns:android="http://schemas.android.com/apk/res/android">
       <font android:fontStyle="normal" android:fontWeight="400"
             android:font="@font/dm_sans_regular"/>
       <font android:fontStyle="normal" android:fontWeight="500"
             android:font="@font/dm_sans_medium"/>
   </font-family>
   ```

5. In `themes.xml` `WC.Text.ScreenTitle`, `WC.Text.HeaderName`, `WC.Button.Primary`, add:
   ```xml
   <item name="android:fontFamily">@font/wc_heading</item>
   ```
   In `WC.Text.Body`, `WC.Text.Caption`, `WC.TextInputEditText`, add:
   ```xml
   <item name="android:fontFamily">@font/wc_body</item>
   ```

---

## Part 7 — Kotlin Fragment Changes (Minimal)

No logic changes needed. Only these visual helpers should be updated in fragments:

**In `HomeFragment.kt` (or equivalent):** Update `today_card` date fields on view creation:
```kotlin
val now = java.util.Calendar.getInstance()
val dayFormat = java.text.SimpleDateFormat("EEEE", java.util.Locale.getDefault())
binding.tvTodayDay.text = dayFormat.format(now.time)
binding.tvTodayDateNum.text = now.get(java.util.Calendar.DAY_OF_MONTH).toString()
binding.tvTodayMonth.text = java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.getDefault()).format(now.time)
```

**In any fragment setting attendance status:** Update `tv_today_att_status` and the pill background:
```kotlin
// When checked in:
binding.tvTodayAttStatus.text = "Checked in"
binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.status_approved))
binding.layoutTodayStatus.background = ContextCompat.getDrawable(requireContext(), R.drawable.bg_today_status_checked_in)

// When not checked in:
binding.tvTodayAttStatus.text = "Not checked in"
binding.tvTodayAttStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.status_rejected))
binding.layoutTodayStatus.background = ContextCompat.getDrawable(requireContext(), R.drawable.bg_today_status_not_in)
```

---

## Verification Checklist

After applying all changes, verify:

- [ ] Login screen: dark hero top section, white card below with negative margin overlap
- [ ] All screen headers: deep midnight → indigo gradient (NOT light blue)
- [ ] Back buttons: frosted glass pill shape, NOT plain icon
- [ ] Module cards (Home): each icon has a distinct gradient background with rounded corners
- [ ] Status badges: `Pending` = amber/yellow, `Approved` = green, `Rejected` = rose/red
- [ ] Primary buttons: dark-to-blue horizontal gradient (NOT flat blue)
- [ ] Cards: `cardCornerRadius="20dp"` on all `MaterialCardView`s
- [ ] Background: `#ECEFFE` (slight lavender tint, NOT pure white or grey-blue)
- [ ] `android:statusBarColor` = `#05091A` (dark, white icons)
- [ ] Text colors: primary = `#050B20`, secondary = `#3A4470`, hint = `#8591BD`

---

*Reference prototype: `White Coffee.html` in the design project. All screens, interactions and exact colors are visible there.*
